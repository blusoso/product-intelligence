/**
 * Visual Enrichment — อ่าน "รูปสินค้า" ด้วย VLM (OpenAI-compatible)
 * ---------------------------------------------------------------
 * หลักการคุมต้นทุน:
 *  1) ส่งเฉพาะรูปหน้าปก (ค่าเริ่มต้น 1 รูป/สินค้า) และใช้ detail=low (~85 token/รูป)
 *  2) ส่งเฉพาะแถวที่ "ข้อความให้ข้อมูลไม่พอ" (ยังไม่มี visual attribute)
 *  3) cache ตาม (model + url + prompt version) → รูปเดิมจ่ายครั้งเดียว
 *  4) มีเพดานต่อรอบ + budget + ยกเลิกได้
 *
 * หลักการความน่าเชื่อถือ:
 *  - ค่าต้องอยู่ใน vocabulary กลาง (enum-only) และเฉพาะ attribute ที่มาจากภาพเท่านั้น
 *  - ทุกค่าต้องมี grounding: `region` (ตำแหน่งภาษาไทย) หรือ `bbox` (0..1)
 *  - ห้ามส่งตัวเลข/การวัด/ราคา — เหมือนชั้นข้อความ
 *  - ไม่มี key / ล้มเหลว / timeout → ข้ามแถวนั้น ไม่ทำให้ pipeline ล้ม
 *
 * ผู้ให้บริการ: DeepSeek (`deepseek-flash` อ่านภาพได้เอง ตั้งแต่ 2026-08)
 *  - ใช้ AI_API_KEY เดิมได้ → ไม่ต้องมี key แยก (ตั้ง VISION_API_KEY เพื่อใช้ key อื่น)
 *  - ต้องส่ง thinking:{type:'disabled'} ไม่งั้น reasoning กิน token จน content ว่าง
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { AiEnrichment, AiTag, AiTagBBox, NormalizedProduct, PipelineConfig } from './types';
import { ATTRIBUTE_MAP, isValidValue, valueLabel, visualEquivalentOf, VISUAL_ATTR_IDS, type AttrId } from './vocab';
import { parseContent } from './json-parse';
import { DEEPSEEK_FLASH_PRICE, mergeTagList, reconcileWithRules, stripTextVisualTags } from './ai';

const DIR = path.join(process.cwd(), 'data', 'network');
const CACHE_FILE = path.join(DIR, 'vision-cache.jsonl');
const MAX_CACHE_LINES = 20000;
const MAX_TAGS_PER_RECORD = 6;
const MAX_REGION_LEN = 60;

export const VISION_PROMPT_VERSION = 'vision-v2';

export type VisionProviderId = 'deepseek' | 'openai' | 'compatible';

/** ค่าเริ่มต้นของผู้ให้บริการแต่ละเจ้า (ใช้เมื่อไม่ได้ตั้ง VISION_*) */
const PRESETS: Record<VisionProviderId, { baseUrl: string; model: string; thinking: boolean }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: false },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', thinking: false },
  compatible: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', thinking: false },
};

export interface VisionConfig {
  provider: VisionProviderId;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /** thinking/reasoning — ปิดไว้เพื่อให้คำตอบสั้น เร็ว และไม่กิน max_tokens */
  thinking: boolean;
  imageMode: 'url' | 'data';
  detail: 'low' | 'high';
  jsonMode: boolean;
  maxTokens: number;
  timeoutMs: number;
  maxImageBytes: number;
  maxImagesPerProduct: number;
  maxPerRun: number;
  concurrency: number;
}

const num = (v: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** ค่า provider → ถ้าไม่ได้ระบุ ใช้ AI_PROVIDER (DeepSeek เป็นค่าตั้งต้นของโปรเจกต์นี้) */
function resolveVisionProvider(): VisionProviderId {
  const raw = (process.env.VISION_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'deepseek' || raw === 'openai' || raw === 'compatible') return raw;
  if (process.env.VISION_BASE_URL) return 'compatible';
  return (process.env.AI_PROVIDER ?? 'deepseek').trim().toLowerCase() === 'deepseek'
    ? 'deepseek'
    : 'openai';
}

/** key: VISION_API_KEY ก่อน ถ้าไม่มีและปลายทางเป็น DeepSeek ใช้ AI_API_KEY เดิม */
function resolveVisionKey(baseUrl: string): string {
  const own = (process.env.VISION_API_KEY ?? '').trim();
  if (own) return own;
  const ai = (process.env.AI_API_KEY ?? '').trim();
  if (ai && /(^|\.)deepseek\.com/i.test(baseUrl)) return ai;
  return '';
}

export function resolveVisionConfig(): VisionConfig {
  const provider = resolveVisionProvider();
  const preset = PRESETS[provider];
  const baseUrl = (process.env.VISION_BASE_URL || preset.baseUrl).replace(/\/+$/, '');
  const key = resolveVisionKey(baseUrl);
  const thinkingEnv = (process.env.VISION_THINKING ?? '').trim().toLowerCase();
  return {
    provider,
    baseUrl,
    model: process.env.VISION_MODEL || preset.model,
    hasKey: Boolean(key),
    thinking: thinkingEnv ? thinkingEnv === '1' || thinkingEnv === 'true' || thinkingEnv === 'enabled' : preset.thinking,
    imageMode: process.env.VISION_IMAGE_MODE === 'data' ? 'data' : 'url',
    detail: process.env.VISION_DETAIL === 'high' ? 'high' : 'low',
    jsonMode: process.env.VISION_JSON_MODE !== '0',
    maxTokens: Math.round(num(process.env.VISION_MAX_TOKENS, provider === 'deepseek' ? 1600 : 700, 200, 8000)),
    timeoutMs: Math.round(num(process.env.VISION_TIMEOUT_MS, 45000, 5000, 120000)),
    maxImageBytes: Math.round(num(process.env.VISION_MAX_IMAGE_BYTES, 2_000_000, 100_000, 10_000_000)),
    maxImagesPerProduct: Math.round(num(process.env.VISION_MAX_IMAGES, 1, 1, 3)),
    maxPerRun: Math.round(num(process.env.VISION_MAX_PER_RUN, 25, 1, 200)),
    concurrency: Math.round(num(process.env.VISION_CONCURRENCY, 2, 1, 4)),
  };
}

export function visionAvailable(config?: Partial<PipelineConfig>): boolean {
  if (process.env.VISION_ENRICH === '0') return false;
  if (!resolveVisionConfig().hasKey) return false;
  if (config && config.vision_enrich === false) return false;
  return true;
}

export interface VisionTokenUsage {
  prompt: number;
  completion: number;
}

export interface VisionRunStats {
  enabled: boolean;
  provider: string;
  model: string;
  requested: number;
  cached: number;
  called: number;
  updated: number;
  failed: number;
  fetch_failed: number;
  invalid: number;
  skipped: number;
  tags: number;
  tokens: VisionTokenUsage;
  cost_usd: number;
  error?: string;
}

export interface VisionProgressEvent {
  done: number;
  total: number;
  called: number;
  cached: number;
  failed: number;
  images: number;
  tags: number;
  elapsed_ms: number;
}

const hash = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);

/* ── prompt ────────────────────────────────────────────────── */

const VOCAB_LINES = VISUAL_ATTR_IDS.map((id) => {
  const def = ATTRIBUTE_MAP[id];
  return `- ${id} (${def.label}): ${def.values.map((v) => `${v.id}=${v.label}`).join(', ')}`;
}).join('\n');

const EXAMPLE = `{"items":[{"key":"shopee:1:2#0","is_spec_image":true,"tags":[
  {"attribute":"visual_features","value_id":"tablet_slot","confidence":0.9,"region":"ขอบบนซ้าย","bbox":{"x":0.1,"y":0.05,"w":0.3,"h":0.12}}
]}]}`;

const SYSTEM_PROMPT = [
  'You read Thai e-commerce product photos and extract ONLY attributes that are clearly visible.',
  'You must answer with a single valid json object only (no markdown, no prose).',
  '',
  'Rules:',
  '1) Choose ONLY value ids from the vocabulary below. Never invent ids.',
  '2) Never output measurements, dimensions, weight, price, stock, sales or review numbers. These are forbidden.',
  '3) Report only what is VISIBLE in the image. If unsure, omit it. Do not guess from the product name.',
  '4) Every tag MUST include evidence: "region" (short Thai location such as "ขอบบนซ้าย") and optionally "bbox" {x,y,w,h} with values 0..1.',
  '5) If the image is not a product/infographic shot (e.g. logo, banner, packaging), return is_spec_image=false and no tags.',
  '6) At most 4 visual_features and 3 material_visual per item.',
  '7) Respond in this exact json shape:',
  EXAMPLE,
].join('\n');

export const VISION_PROMPT_PREVIEW = SYSTEM_PROMPT;

function buildUserText(p: NormalizedProduct, imageIndex: number, imageCount: number): string {
  return [
    `PRODUCT: ${String(p.name ?? '').slice(0, 200)}`,
    `CATEGORY: ${p.category} / ${p.product_type}`,
    `VOCABULARY (attribute: allowed ids=label)`,
    VOCAB_LINES,
    '',
    `Read IMAGE ${imageIndex + 1} of ${imageCount} and return json only.`,
  ].join('\n');
}

/* ── validation ────────────────────────────────────────────── */

function clamp01(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

function parseBBox(raw: any): AiTagBBox | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const x = clamp01(raw.x);
  const y = clamp01(raw.y);
  const w = clamp01(raw.w ?? raw.width);
  const h = clamp01(raw.h ?? raw.height);
  if (x == null || y == null || w == null || h == null) return undefined;
  if (w <= 0 || h <= 0) return undefined;
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    w: Math.round(w * 1000) / 1000,
    h: Math.round(h * 1000) / 1000,
  };
}

/**
 * ตรวจ/แปลงคำตอบ VLM → AiTag[]
 * - attribute ต้องอยู่ใน VISUAL_ATTR_IDS เท่านั้น (กันโมเดลตอบเรื่องอื่น)
 * - ต้องมี region หรือ bbox ไม่งั้นต้องมั่นใจ ≥ 0.6
 * - ตัดค่าที่ซ้ำความหมายกับ finish (มุม material_visual)
 */
export function validateVisionTags(
  raw: any[],
  p: NormalizedProduct,
  image: string,
): { tags: AiTag[]; invalid: number; duplicate: number } {
  const tags: AiTag[] = [];
  let invalid = 0;
  let duplicate = 0;
  const perAttr = new Map<string, number>();
  const existing = p.ai?.tags ?? [];

  for (const entry of Array.isArray(raw) ? raw : []) {
    const attribute = String(entry?.attribute ?? '') as AttrId;
    const valueId = String(entry?.value_id ?? '');
    if (!VISUAL_ATTR_IDS.includes(attribute) || !isValidValue(attribute, valueId)) {
      invalid += 1;
      continue;
    }
    const def = ATTRIBUTE_MAP[attribute];
    const used = perAttr.get(attribute) ?? 0;
    if (used >= def.max_per_record) {
      invalid += 1;
      continue;
    }
    const eq = visualEquivalentOf(attribute, valueId);
    if (eq && existing.some((t) => t.attribute === eq.attribute && t.value_id === eq.value_id)) {
      duplicate += 1;
      continue;
    }
    const confidenceRaw = Number(entry?.confidence);
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;
    const region = typeof entry?.region === 'string' ? entry.region.trim().slice(0, MAX_REGION_LEN) : '';
    const bbox = parseBBox(entry?.bbox);
    const grounded = Boolean(region || bbox);
    if (!grounded && confidence < 0.6) {
      invalid += 1;
      continue;
    }
    perAttr.set(attribute, used + 1);
    tags.push({
      attribute,
      value_id: valueId,
      value: valueLabel(attribute, valueId),
      confidence: Math.round(confidence * 100) / 100,
      grounded,
      evidence_type: 'image',
      origin: 'vision',
      image,
      ...(region ? { region } : {}),
      ...(bbox ? { bbox } : {}),
    });
    if (tags.length >= MAX_TAGS_PER_RECORD) break;
  }
  return { tags, invalid, duplicate };
}

/* ── cache ─────────────────────────────────────────────────── */

interface VisionCacheRow {
  key: string;
  at: string;
  image: string;
  tags: AiTag[];
}

async function readVisionCache(): Promise<Map<string, AiTag[]>> {
  const map = new Map<string, AiTag[]>();
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as VisionCacheRow;
        if (row?.key && Array.isArray(row.tags)) map.set(row.key, row.tags);
      } catch {
        /* ข้ามบรรทัดพัง */
      }
    }
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  return map;
}

async function writeVisionCache(rows: VisionCacheRow[]): Promise<void> {
  if (!rows.length) return;
  // กันซ้ำในชุดเดียวกัน (เช่น รูปเดียวถูกอ้างจากสองแถว) — เก็บรายการหลังสุด
  const byKey = new Map<string, VisionCacheRow>();
  for (const r of rows) byKey.set(r.key, r);
  const fresh = [...byKey.values()];
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.appendFile(CACHE_FILE, `${fresh.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const all = raw.split(/\r?\n/).filter((l) => l.trim());
    if (all.length > MAX_CACHE_LINES) {
      await fs.writeFile(CACHE_FILE, `${all.slice(-MAX_CACHE_LINES).join('\n')}\n`, 'utf8');
    }
  } catch {
    /* cache เขียนไม่ได้ไม่เป็นไร */
  }
}

/* ── image → data url ──────────────────────────────────────── */

async function fetchAsDataUrl(
  url: string,
  maxBytes: number,
): Promise<{ dataUrl?: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = String(res.headers.get('content-type') ?? '').toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp)/.test(type)) return { error: `unsupported type ${type || 'unknown'}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { error: `too large ${buf.byteLength}` };
    const mime = type.includes('png') ? 'image/png' : type.includes('webp') ? 'image/webp' : 'image/jpeg';
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'timeout' : e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── เรียกโมเดล ────────────────────────────────────────────── */

interface VisionCallResult {
  tags?: AiTag[];
  raw?: any[];
  error?: string;
  usage?: VisionTokenUsage;
  fetched?: boolean;
}

async function callVision(
  p: NormalizedProduct,
  image: string,
  cfg: VisionConfig,
  index: number,
  count: number,
  asData: boolean,
): Promise<VisionCallResult> {
  let imageUrl = image;
  let fetched = false;
  if (asData) {
    const dl = await fetchAsDataUrl(image, cfg.maxImageBytes);
    if (!dl.dataUrl) return { error: `fetch:${dl.error}` };
    imageUrl = dl.dataUrl;
    fetched = true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserText(p, index, count) },
            { type: 'image_url', image_url: { url: imageUrl, detail: cfg.detail } },
          ],
        },
      ],
      max_tokens: cfg.maxTokens,
      stream: false,
      temperature: 0,
    };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    // DeepSeek: ปิด thinking ไม่งั้น reasoning กิน max_tokens จน content ว่าง
    if (cfg.provider === 'deepseek') body.thinking = { type: cfg.thinking ? 'enabled' : 'disabled' };

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolveVisionKey(cfg.baseUrl)}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { error: `HTTP ${res.status} ${text.slice(0, 160)}`, fetched };
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: 'invalid response body', fetched };
    }
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    const usage: VisionTokenUsage = {
      prompt: Number(json?.usage?.prompt_tokens ?? 0),
      completion: Number(json?.usage?.completion_tokens ?? 0),
    };
    if (typeof content !== 'string' || !content.trim()) {
      return { error: 'empty content', usage, fetched };
    }
    const items = parseContent(content);
    if (!items) return { error: 'invalid json content', usage, fetched };
    const first = items[0];
    const raw = Array.isArray(first?.tags) ? first.tags : Array.isArray(first) ? first : [];
    return { raw, usage, fetched };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'timeout' : e?.message || String(e), fetched };
  } finally {
    clearTimeout(timer);
  }
}

/* ── ตัวงานหลัก ────────────────────────────────────────────── */

export interface VisionEnrichResult {
  stats: VisionRunStats;
  updatedKeys: Set<string>;
}

export function visionImages(p: NormalizedProduct, cfg: VisionConfig): string[] {
  const list = (p.images?.length ? p.images : p.image ? [p.image] : []).filter((u) =>
    /^https?:\/\//i.test(u),
  );
  return [...new Set(list)].slice(0, cfg.maxImagesPerProduct);
}

/** แถวนี้ควรส่งให้ VLM หรือไม่ */
export function needsVision(p: NormalizedProduct, cfg: VisionConfig, force = false): boolean {
  if (!visionImages(p, cfg).length) return false;
  if (force) return true;
  // เคยอ่านภาพแล้ว (แม้ไม่พบค่า) → ไม่ต้องจ่ายซ้ำ เว้นแต่สั่ง force
  if (p.ai?.meta?.vision) return false;
  return !(p.ai?.tags ?? []).some((t) => VISUAL_ATTR_IDS.includes(t.attribute as AttrId));
}

export async function enrichWithVision(
  products: NormalizedProduct[],
  opts: {
    config?: Partial<PipelineConfig>;
    budgetMs?: number;
    force?: boolean;
    onProgress?: (e: VisionProgressEvent) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<VisionEnrichResult> {
  const cfg = resolveVisionConfig();
  const config = opts.config ?? {};
  const enabled = visionAvailable(config);
  const stats: VisionRunStats = {
    enabled,
    provider: cfg.provider,
    model: cfg.model,
    requested: 0,
    cached: 0,
    called: 0,
    updated: 0,
    failed: 0,
    fetch_failed: 0,
    invalid: 0,
    skipped: 0,
    tags: 0,
    tokens: { prompt: 0, completion: 0 },
    cost_usd: 0,
  };
  const updatedKeys = new Set<string>();
  if (!enabled) return { stats, updatedKeys };

  const maxRecords = Math.max(
    0,
    Math.min(200, Math.round(Number(config.vision_max_records_per_run ?? cfg.maxPerRun))),
  );
  const candidates = products.filter((p) => needsVision(p, cfg, opts.force));
  stats.requested = candidates.length;
  const selected = candidates.slice(0, maxRecords);
  stats.skipped = candidates.length - selected.length;
  if (!selected.length) return { stats, updatedKeys };

  const deadline = Date.now() + Math.max(10000, opts.budgetMs ?? 120000);
  const cache = await readVisionCache();
  const startedAt = Date.now();
  const newRows: VisionCacheRow[] = [];
  let done = 0;

  const emit = () => {
    opts.onProgress?.({
      done,
      total: selected.length,
      called: stats.called,
      cached: stats.cached,
      failed: stats.failed,
      images: stats.called + stats.cached,
      tags: stats.tags,
      elapsed_ms: Date.now() - startedAt,
    });
  };

  const processOne = async (p: NormalizedProduct) => {
    const images = visionImages(p, cfg);
    const collected: AiTag[] = [];
    /** อ่านสำเร็จอย่างน้อย 1 รูป (แม้ไม่พบค่าที่มองเห็น) — ใช้ตัดสินว่าจะบันทึก meta ไหม */
    let readOk = false;
    for (let i = 0; i < images.length; i++) {
      if (opts.shouldStop?.() || Date.now() > deadline) return;
      const image = images[i];
      const key = hash({
        v: VISION_PROMPT_VERSION,
        model: cfg.model,
        detail: cfg.detail,
        thinking: cfg.thinking,
        max_tokens: cfg.maxTokens,
        url: image,
      });
      const hit = cache.get(key);
      if (hit) {
        collected.push(...hit.map((t) => ({ ...t, image })));
        stats.cached += 1;
        continue;
      }
      let res = await callVision(p, image, cfg, i, images.length, cfg.imageMode === 'data');
      // ผู้ให้บริการบางเจ้าดึง URL เองไม่ได้ → ลองส่งเป็น base64 ครั้งเดียว
      if (res.error && !res.fetched && /fetch|download|url|image/i.test(res.error)) {
        const retry = await callVision(p, image, cfg, i, images.length, true);
        if (retry.raw) res = retry;
        else stats.fetch_failed += 1;
      }
      if (res.usage) {
        stats.tokens.prompt += res.usage.prompt;
        stats.tokens.completion += res.usage.completion;
      }
      if (!res.raw) {
        stats.failed += 1;
        stats.error = res.error;
        continue;
      }
      stats.called += 1;
      readOk = true;
      const { tags, invalid, duplicate } = validateVisionTags(res.raw, p, image);
      stats.invalid += invalid + duplicate;
      // cache ทุกรูปที่อ่านสำเร็จ — รวมกรณี "ไม่พบค่าที่มองเห็น" เพื่อไม่ต้องจ่ายซ้ำทุกรอบ
      newRows.push({ key, at: new Date().toISOString(), image, tags });
      if (tags.length) collected.push(...tags);
    }

    // อ่านไม่สำเร็จเลย → ไม่เขียนทับข้อมูลเดิม
    if (!collected.length && !readOk) return;
    const reconciled = collected.length ? reconcileWithRules(collected, p) : [];
    const merged = collected.length ? mergeTagList(reconciled, p.ai?.tags ?? []) : p.ai?.tags ?? [];
    const meta = p.ai?.meta;
    const ai: AiEnrichment = {
      tags: merged.slice(0, 14),
      meta: {
        provider: meta?.provider ?? cfg.provider,
        model: meta?.model ?? cfg.model,
        prompt_version: meta?.prompt_version ?? VISION_PROMPT_VERSION,
        at: new Date().toISOString(),
        status: meta?.status === 'disabled' ? 'disabled' : 'ok',
        cached: false,
        ...(meta?.error ? { error: meta.error } : {}),
        ...(meta?.phrase_version ? { phrase_version: meta.phrase_version } : {}),
        vision: {
          model: cfg.model,
          prompt_version: VISION_PROMPT_VERSION,
          at: new Date().toISOString(),
          images: images.length,
          region: collected.some((t) => t.region || t.bbox),
        },
      },
    };
    // ภาพคือแหล่งเดียวของค่าที่ "มองเห็น" → ทิ้งแท็ก visual ที่ชั้นข้อความเดาไว้
    // (ทำหลังประกอบ meta แล้ว เพื่อให้มี vision evidence จริงก่อนตัดสิน)
    p.ai = { ...ai, tags: stripTextVisualTags(ai.tags, ai.meta) };
    stats.tags += collected.length;
    stats.updated += 1;
    updatedKeys.add(p.node_key);
  };

  // ตัวชี้คิวต้องอยู่ "นอก" worker — ถ้าประกาศใน worker ทุกตัวจะเริ่มที่ 0
  // แล้วแถวแรกๆ ถูกอ่านซ้ำ (จ่ายเงินซ้ำ) ตามจำนวน concurrency
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(cfg.concurrency, selected.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= selected.length) return;
      if (opts.shouldStop?.()) return;
      try {
        await processOne(selected[i]);
      } catch (e: any) {
        stats.failed += 1;
        stats.error = e?.message || String(e);
      }
      done += 1;
      emit();
    }
  });
  emit();
  await Promise.all(workers);

  // ประมาณต้นทุน: ตั้ง VISION_COST_*_PER_M เองได้ ไม่งั้นใช้ราคา DeepSeek flash
  const inPrice = Number(process.env.VISION_COST_INPUT_PER_M);
  const outPrice = Number(process.env.VISION_COST_OUTPUT_PER_M);
  if (Number.isFinite(inPrice) && Number.isFinite(outPrice)) {
    stats.cost_usd =
      Math.round(((stats.tokens.prompt * inPrice + stats.tokens.completion * outPrice) / 1_000_000) * 1e6) /
      1e6;
  } else if (cfg.provider === 'deepseek') {
    stats.cost_usd =
      Math.round(
        ((stats.tokens.prompt * DEEPSEEK_FLASH_PRICE.input +
          stats.tokens.completion * DEEPSEEK_FLASH_PRICE.output) /
          1_000_000) *
          1e6,
      ) / 1e6;
  }

  await writeVisionCache(newRows);
  return { stats, updatedKeys };
}

/** สถานะสำหรับ UI/health (ไม่มีความลับ) */
export function visionStatus() {
  const cfg = resolveVisionConfig();
  return {
    available: visionAvailable(),
    provider: cfg.provider,
    model: cfg.model,
    base_url: cfg.baseUrl,
    detail: cfg.detail,
    thinking: cfg.thinking,
    image_mode: cfg.imageMode,
    max_images: cfg.maxImagesPerProduct,
    max_per_run: cfg.maxPerRun,
    key_source: (process.env.VISION_API_KEY ?? '').trim()
      ? 'VISION_API_KEY'
      : cfg.hasKey
        ? 'AI_API_KEY'
        : null,
  };
}
