/**
 * AI-assisted enrichment (DeepSeek / OpenAI-compatible)
 * -----------------------------------------------------
 * ให้ AI ช่วยสกัด attribute จาก "ชื่อ + สเปก + ตัวเลือก + description"
 * โดยเลือกค่าได้เฉพาะ id ใน vocabulary กลาง (enum-only)
 *
 * หลักประกัน:
 *  - ไม่มีฟิลด์ตัวเลข/การวัดใน output → AI เขียนขนาด/ราคา/ยอดขายไม่ได้
 *  - ทุกค่าเก็บใน ai_enrichment (แยกจาก enrichment ที่เป็นหลักฐาน)
 *  - อ้าง quote ต้องพบข้อความจริงในข้อมูลขาเข้า (grounded)
 *  - ไม่มี key / ล้มเหลว / timeout → คืน null และไม่ทำให้ pipeline ล้ม
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type {
  AiEnrichment,
  AiTag,
  NormalizedProduct,
  PipelineConfig,
} from "./types";
import {
  ATTR_IDS,
  ATTRIBUTE_MAP,
  isValidValue,
  valueLabel,
  VISUAL_ATTR_IDS,
  VOCAB_VERSION,
  type AttrId,
} from "./vocab";
import {
  findQuote,
  normalizeForMatch,
  normalizeForModel,
  TEXT_NORM_VERSION,
} from "./normalize-text";
import { parseContent } from "./json-parse";
import { SEO_TERMS } from "./seo-keywords";
import {
  sanitizeAiTag,
  sanitizeAiTags,
  validateEnrichment,
} from "./validate-enrichment";
import {
  harvestPhrases,
  loadPhrases,
  matchPhrases,
  matchText,
  PHRASE_VERSION,
  type PhraseMap,
} from "./phrase-memory";

const DIR = path.join(process.cwd(), "data", "network");
const CACHE_FILE = path.join(DIR, "ai-cache.jsonl");
const MAX_CACHE_LINES = 20000;
const MAX_TAGS_PER_RECORD = 20;
const MAX_QUOTE_LEN = 120;
const MAX_DESCRIPTION_CHARS = 800;

/**
 * bump เมื่อแก้ prompt/กติกา — ทำให้ cache เก่าไม่ถูกใช้ซ้ำ
 * v5: keyword audit + SEO guardrail + vision-only visual attrs + audience evidence
 */
export const PROMPT_VERSION = "ai-enrich-v5-keyword-audit";

export type AiProviderId = "deepseek" | "openai" | "compatible";

export interface AiProviderConfig {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  /** DeepSeek: thinking mode (default false = เร็วกว่า/ถูกกว่า/temperature มีผล) */
  thinking: boolean;
  jsonMode: boolean;
  maxTokens: number;
  timeoutMs: number;
  batchSize: number;
  concurrency: number;
  temperature: number;
  userId: string | null;
}

const PROVIDER_PRESETS: Record<
  AiProviderId,
  Pick<AiProviderConfig, "baseUrl" | "model" | "thinking">
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    thinking: false,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    thinking: false,
  },
  compatible: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    thinking: false,
  },
};

const num = (
  v: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export function resolveAiConfig(): AiProviderConfig {
  const provider = (["deepseek", "openai", "compatible"] as const).includes(
    (process.env.AI_PROVIDER ?? "deepseek") as AiProviderId,
  )
    ? ((process.env.AI_PROVIDER ?? "deepseek") as AiProviderId)
    : "deepseek";
  const preset = PROVIDER_PRESETS[provider];
  const thinkingEnv = (process.env.AI_THINKING ?? "").toLowerCase();
  return {
    provider,
    baseUrl: (process.env.AI_BASE_URL || preset.baseUrl).replace(/\/+$/, ""),
    model: process.env.AI_MODEL || preset.model,
    thinking:
      thinkingEnv === "enabled" ||
      thinkingEnv === "1" ||
      thinkingEnv === "true",
    jsonMode: process.env.AI_JSON_MODE !== "0",
    maxTokens: Math.round(num(process.env.AI_MAX_TOKENS, 1500, 200, 16000)),
    timeoutMs: Math.round(num(process.env.AI_TIMEOUT_MS, 30000, 3000, 120000)),
    batchSize: Math.round(num(process.env.AI_BATCH_SIZE, 10, 1, 25)),
    concurrency: Math.round(num(process.env.AI_CONCURRENCY, 3, 1, 5)),
    temperature: num(process.env.AI_TEMPERATURE, 0, 0, 2),
    userId: process.env.AI_USER_ID || null,
  };
}

export function aiModel(): string {
  return resolveAiConfig().model;
}

export function aiAvailable(config?: Partial<PipelineConfig>): boolean {
  if (!process.env.AI_API_KEY) return false;
  if (process.env.AI_ENRICH === "0") return false;
  if (config && config.ai_enrich === false) return false;
  return true;
}

export interface AiTokenUsage {
  prompt: number;
  completion: number;
  cached: number;
}

export interface AiRunStats {
  enabled: boolean;
  provider: string;
  model: string;
  thinking: boolean;
  requested: number;
  cached: number;
  called: number;
  batches: number;
  updated: number;
  failed: number;
  invalid: number;
  skipped: number;
  second_pass: number;
  retries: number;
  empty_responses: number;
  /** จำนวนแท็กที่ได้จากพจนานุกรมวลี (ไม่เสียค่า API) */
  phrase_hits: number;
  /** จำนวนแถวที่วลีจับได้แต่สแกนในข้อความจริงไม่เจอ (ถูกปล่อยให้ AI) */
  phrase_misses: number;
  /** จำนวนแถวที่ถูก gate (กฎให้ข้อมูลครบแล้ว ไม่ต้องเรียก AI เต็ม) */
  gated: number;
  /** จำนวนแถวที่ได้ focus pass เฉพาะ attribute ที่กฎสร้างไม่ได้ */
  focus_pass: number;
  /** จำนวนแถวที่ผ่านชั้นอ่านภาพ */
  vision_called: number;
  vision_cached: number;
  vision_failed: number;
  vision_fetch_failed: number;
  /** จำนวน conflict ที่ส่งเข้าคิวให้คนตรวจ */
  conflicts_enqueued: number;
  tokens: AiTokenUsage;
  cost_usd: number;
  error?: string;
}

/** ความคืบหน้าระหว่างเรียก AI — ใช้สตรีมให้ UI แสดง progress bar */
export interface AiProgressEvent {
  phase: "calling" | "second_pass" | "focus" | "vision";
  /** แถวที่ประมวลผลเสร็จแล้ว (รวม cache hit) */
  done: number;
  /** แถวทั้งหมดที่เลือกมาในรอบนี้ */
  total: number;
  batches_done: number;
  batches_total: number;
  called: number;
  cached: number;
  failed: number;
  tokens: AiTokenUsage;
  cost_usd: number;
  elapsed_ms: number;
  /** second pass: จำนวนแถวที่กำลังเก็บตก */
  focus_total?: number;
  focus_done?: number;
}

const emptyStats = (cfg: AiProviderConfig, enabled: boolean): AiRunStats => ({
  enabled,
  provider: cfg.provider,
  model: cfg.model,
  thinking: cfg.thinking,
  requested: 0,
  cached: 0,
  called: 0,
  batches: 0,
  updated: 0,
  failed: 0,
  invalid: 0,
  skipped: 0,
  second_pass: 0,
  retries: 0,
  empty_responses: 0,
  phrase_hits: 0,
  phrase_misses: 0,
  gated: 0,
  focus_pass: 0,
  vision_called: 0,
  vision_cached: 0,
  vision_failed: 0,
  vision_fetch_failed: 0,
  conflicts_enqueued: 0,
  tokens: { prompt: 0, completion: 0, cached: 0 },
  cost_usd: 0,
});

const hash = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AiInput {
  key: string;
  name: string;
  specs: string[];
  options: string[];
  description: string;
  category: string;
  product_type: string;
  /** ข้อความต้นฉบับ (ก่อน normalize) — ใช้เป็น fallback ตอนตรวจ grounding ของ quote */
  raw: string;
}

interface CacheRow {
  key: string;
  at: string;
  ai: AiEnrichment;
}

function toInput(p: NormalizedProduct, index: number): AiInput {
  const specPairs = (p.specs ?? [])
    .slice(0, 20)
    .map(
      (s) =>
        `${normalizeForModel(s.name).slice(0, 40)}: ${normalizeForModel(s.value).slice(0, 80)}`,
    );
  const options = (p.variants ?? [])
    .slice(0, 10)
    .map((v) =>
      normalizeForModel(String(v.name ?? v.model_id ?? "")).slice(0, 60),
    )
    .filter(Boolean);
  const raw = normalizeForMatch(
    [
      String(p.name ?? ""),
      ...(p.specs ?? []).slice(0, 20).map((s) => `${s.name} ${s.value}`),
      ...(p.variants ?? [])
        .slice(0, 10)
        .map((v) => String(v.name ?? v.model_id ?? "")),
      String(p.description ?? ""),
    ].join(" "),
  );
  return {
    key: `${p.node_key || p.ext || index}`,
    name: normalizeForModel(p.name).slice(0, 300),
    specs: specPairs,
    options,
    description: normalizeForModel(p.description).slice(
      0,
      MAX_DESCRIPTION_CHARS,
    ),
    category: String(p.category ?? ""),
    product_type: String(p.product_type ?? ""),
    raw,
  };
}

/** ตรวจว่าแท็กที่ AI ให้ "อ้างข้อความจริง" หรือไม่ (ผ่อนปรนด้วยข้อความต้นฉบับ) */
function groundOf(
  input: AiInput,
  quote: string,
  text: string,
): "normalized" | "raw" | null {
  return findQuote(quote, text, input.raw);
}

function cacheKey(input: AiInput): string {
  const cfg = resolveAiConfig();
  return hash({
    v: PROMPT_VERSION,
    norm: TEXT_NORM_VERSION,
    vocab: VOCAB_VERSION,
    phrase: PHRASE_VERSION,
    provider: cfg.provider,
    model: cfg.model,
    thinking: cfg.thinking,
    temperature: cfg.temperature,
    // hash เฉพาะฟิลด์ที่ส่งให้โมเดล (ไม่รวม raw เพื่อไม่ให้ cache แตกจากความต่างเล็กน้อย)
    input: {
      key: input.key,
      name: input.name,
      specs: input.specs,
      options: input.options,
      description: input.description,
      category: input.category,
      product_type: input.product_type,
    },
  });
}

/**
 * รายการ vocab ที่ส่งให้โมเดล
 * - focus = ตัดเหลือเฉพาะ attribute ที่ต้องการ (ประหยัด token ในโหมด focused/second pass)
 */
function vocabPrompt(focus?: string[]): string {
  const visual = new Set<string>(VISUAL_ATTR_IDS);
  const ids = (
    focus?.length ? ATTR_IDS.filter((id) => focus.includes(id)) : ATTR_IDS
  ).filter((id) => !visual.has(id));
  return ids
    .map((id) => {
      const def = ATTRIBUTE_MAP[id];
      const values = def.values.map((v) => `${v.id}=${v.label}`).join(", ");
      return `- ${id} (${def.label}): ${values}`;
    })
    .join("\n");
}

const EXAMPLE_JSON = `{"items":[{"key":"shopee:1:2","tags":[
  {"attribute":"use_case","value_id":"desk_work","confidence":0.9,"quote":"โต๊ะทำงาน"},
  {"attribute":"context","value_id":"workspace","confidence":0.8,"quote":"โฮมออฟฟิศ"},
  {"attribute":"audience","value_id":"office_worker","confidence":0.5}
]}]}`;

const SYSTEM_PROMPT = [
  "You extract structured product attributes for Thai e-commerce listings.",
  "You must answer with a single valid json object only (no markdown, no prose).",
  "",
  "Rules:",
  "1) Choose ONLY value ids from the provided vocabulary. Never invent ids.",
  "2) Never output measurements, dimensions, weight, price, stock, sales or review numbers. These are forbidden.",
  "3) If the text does not support an attribute, omit it. Do not guess blindly.",
  '4) If you cite evidence, "quote" MUST be an exact substring of the item text (name/specs/options/description).',
  "5) If a value is inferred without a literal quote, leave quote empty; confidence <= 0.6.",
  "6) At most 5 values per attribute and at most 20 attributes per item.",
  "7) SYNONYM RULE: If the text uses a synonym or related term, you MAY extract the closest value id. Examples:",
  '   - "ขาเหล็ก" -> material_visual:metal_frame (or finish:metal)',
  '   - "พับเก็บได้" -> adjustability:foldable',
  '   - "ประกอบเอง" -> assembly:flat_pack',
  "8) SEO TRAP RULE: DO NOT infer style or context from pure SEO keywords like:",
  '   "ญี่ปุ่น" (Japanese) when it is part of the product name, "มูจิ", "เกาหลี", "มินิมอล".',
  "   Only infer style/context if the text also contains an actual description that confirms the design.",
  "9) Respond in this exact json shape:",
  EXAMPLE_JSON,
].join("\n");

/** ตัวอย่าง system prompt สำหรับ health check / debug (ไม่มีความลับ) */
export const SYSTEM_PROMPT_PREVIEW = SYSTEM_PROMPT;

function buildUserPrompt(batch: AiInput[], focus?: string[]): string {
  const lines = [
    "VOCABULARY (attribute: allowed ids=label)",
    vocabPrompt(focus),
    "",
  ];
  if (focus?.length) {
    lines.push(
      `FOCUS: only extract these attributes: ${focus.join(", ")}. If unsure, return an empty tags array.`,
    );
    lines.push("");
  }
  lines.push(
    "ITEMS (json)",
    JSON.stringify(
      batch.map((b) => ({
        key: b.key,
        name: b.name,
        specs: b.specs,
        options: b.options,
        description: b.description,
        category: b.category,
        product_type: b.product_type,
      })),
    ),
    "",
    "Return json only, matching the example shape.",
  );
  return lines.join("\n");
}

interface ModelResponse {
  items?: any[];
  usage?: AiTokenUsage;
  error?: string;
  empty?: boolean;
  raw?: string;
}

async function callOnce(
  batch: AiInput[],
  cfg: AiProviderConfig,
  focus: string[] | undefined,
  maxTokens: number,
): Promise<ModelResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(batch, focus) },
      ],
      max_tokens: maxTokens,
      stream: false,
    };
    if (cfg.jsonMode) body.response_format = { type: "json_object" };
    if (cfg.provider === "deepseek") {
      body.thinking = { type: cfg.thinking ? "enabled" : "disabled" };
      if (!cfg.thinking) body.temperature = cfg.temperature;
    } else {
      body.temperature = cfg.temperature;
    }
    if (cfg.userId) body.user_id = cfg.userId;

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      return {
        error: `HTTP ${res.status}${retryable ? ":retry" : ""} ${raw.slice(0, 200)}`,
      };
    }
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return { error: "invalid response body" };
    }
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    const usage: AiTokenUsage = {
      prompt: Number(json?.usage?.prompt_tokens ?? 0),
      completion: Number(json?.usage?.completion_tokens ?? 0),
      cached: Number(
        json?.usage?.prompt_cache_hit_tokens ??
          json?.usage?.prompt_tokens_details?.cached_tokens ??
          0,
      ),
    };
    if (typeof content !== "string" || content.trim() === "") {
      return { error: "empty content", empty: true, usage };
    }
    const finish = String(choice?.finish_reason ?? "");
    const items = parseContent(content);
    if (!items) {
      // ถ้าถูกตัดกลางคันเพราะ max_tokens ให้ขยายแล้วลองใหม่ ไม่ใช่ JSON เสีย
      return {
        error:
          finish === "length" ? "truncated:length" : "invalid json content",
        usage,
        raw: content.slice(0, 160),
      };
    }
    if (finish === "length") return { error: "truncated:length", items, usage };
    return { items, usage };
  } catch (e: any) {
    return {
      error:
        e?.name === "AbortError"
          ? "timeout:retry"
          : `${e?.message || String(e)}:retry`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestBatch(
  batch: AiInput[],
  cfg: AiProviderConfig,
  focus: string[] | undefined,
  stats: AiRunStats,
  deadline: number,
  depth = 0,
): Promise<any[]> {
  let maxTokens = cfg.maxTokens;
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (Date.now() > deadline) {
      stats.error = "budget";
      return [];
    }
    const res = await callOnce(batch, cfg, focus, maxTokens);
    if (res.usage) {
      stats.tokens.prompt += res.usage.prompt;
      stats.tokens.completion += res.usage.completion;
      stats.tokens.cached += res.usage.cached;
    }
    // ถูกตัดเพราะ max_tokens (ไม่มี items ให้ใช้) → ขยายเพดานแล้วลองใหม่
    if (!res.items && res.error === "truncated:length" && attempt < 3) {
      maxTokens = Math.min(Math.round(maxTokens * 2), 8000);
      stats.retries += 1;
      continue;
    }
    if (res.items) {
      if (res.error === "truncated:length" && attempt < 3) {
        maxTokens = Math.min(Math.round(maxTokens * 2), 8000);
        stats.retries += 1;
        continue;
      }
      return res.items;
    }
    lastError = res.error ?? "unknown";
    if (res.empty) stats.empty_responses += 1;
    const retryable =
      /retry/.test(lastError) || res.empty || /invalid json/.test(lastError);
    if (!retryable || attempt === 3) break;
    stats.retries += 1;
    await sleep(attempt === 1 ? 600 : 1800);
  }
  stats.error = lastError;

  // ยังไม่ได้ JSON ทั้งชุด → แบ่ง batch ครึ่งแล้วลองใหม่ (batch เล็กมักผ่าน)
  if (depth < 2 && batch.length > 1) {
    const mid = Math.ceil(batch.length / 2);
    const head = await requestBatch(
      batch.slice(0, mid),
      cfg,
      focus,
      stats,
      deadline,
      depth + 1,
    );
    const tail = await requestBatch(
      batch.slice(mid),
      cfg,
      focus,
      stats,
      deadline,
      depth + 1,
    );
    if (head.length || tail.length) return [...head, ...tail];
  }
  return [];
}

/* ── validation ─────────────────────────────────────────────── */

function normalizeText(s: string): string {
  // CHANGELOG v2: ใช้ normalizeForMatch จาก normalize-text เพื่อความสอดคล้อง
  // (ลบ whitespace ทั้งหมด)
  return s
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
}

function sourceText(input: AiInput): string {
  return normalizeText(
    [
      input.name,
      ...input.specs,
      ...input.options,
      input.description,
      input.category,
      input.product_type,
    ].join(" "),
  );
}

export function validateAiTags(
  raw: any,
  input: AiInput,
  minConfidence: number,
): {
  tags: AiTag[];
  invalid: number;
  rejected_by_attr: Record<string, number>;
} {
  const tags: AiTag[] = [];
  let invalid = 0;
  const rejectedByAttr: Record<string, number> = {};
  const reject = (attr: unknown) => {
    invalid += 1;
    const key = typeof attr === "string" ? attr : "_unknown";
    rejectedByAttr[key] = (rejectedByAttr[key] ?? 0) + 1;
  };

  const text = sourceText(input);
  const list = Array.isArray(raw) ? raw : [];
  const perAttr = new Map<string, number>();

  for (const entry of list) {
    const attribute = entry?.attribute;
    const valueId = entry?.value_id;
    if (!ATTR_IDS.includes(attribute) || !isValidValue(attribute, valueId)) {
      reject(attribute);
      continue;
    }
    const def = ATTRIBUTE_MAP[attribute as AttrId];
    const used = perAttr.get(attribute) ?? 0;
    if (used >= def.max_per_record) {
      reject(attribute);
      continue;
    }
    const confidenceRaw = Number(entry?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const quote =
      typeof entry?.quote === "string"
        ? entry.quote.slice(0, MAX_QUOTE_LEN)
        : "";
    const normalizedQuote = normalizeText(quote);
    const grounded =
      normalizedQuote.length >= 3 && text.includes(normalizedQuote);

    if (grounded && confidence < minConfidence) {
      reject(attribute);
      continue;
    }
    if (!grounded && confidence < Math.max(minConfidence, 0.45)) {
      reject(attribute);
      continue;
    }
    perAttr.set(attribute, used + 1);
    tags.push({
      attribute: attribute as AttrId,
      value_id: valueId,
      value: valueLabel(attribute as AttrId, valueId),
      confidence: Math.round(confidence * 100) / 100,
      grounded,
      ...(quote && grounded ? { quote } : {}),
    });
    if (tags.length >= MAX_TAGS_PER_RECORD) break;
  }
  return { tags, invalid, rejected_by_attr: rejectedByAttr };
}

/**
 * attribute ที่หลายค่าเสริมกันได้ — AI ที่ให้ค่าต่างจาก rule ไม่ใช่ "ขัดแย้ง"
 * (rule ยังเป็นหลักฐานหลัก; ค่าของ AI ถูกเก็บเพิ่ม)
 */
// attribute ที่เป็น multi-label ได้ → ไม่ต้องมาร์ค conflict ถึงจะมีค่าต่างจาก rule
const MULTI_LABEL_ATTRS: ReadonlySet<string> = new Set([
  "use_case",
  "function",
  "context",
  "style",
  "space",
  "audience",
  "occasion",
]);

export function reconcileWithRules(
  tags: AiTag[],
  p: NormalizedProduct,
): AiTag[] {
  const ruleByAttr = new Map<string, string[]>();
  const rule = p.enrichment;
  const push = (attr: string, values: string[]) => {
    if (values.length) ruleByAttr.set(attr, values);
  };
  push("use_case", rule?.use_cases.map((t) => t.id) ?? []);
  push("function", rule?.functions.map((t) => t.id) ?? []);
  push("context", rule?.contexts.map((t) => t.id) ?? []);
  push("style", rule?.styles.map((t) => t.id) ?? []);
  push("space", rule?.spaces.map((t) => t.id) ?? []);

  const out: AiTag[] = [];
  for (const tag of tags) {
    const ruleIds = ruleByAttr.get(tag.attribute);
    // ถ้า rule มีค่านี้อยู่แล้ว → ข้าม (เก็บของ rule)
    if (ruleIds?.includes(tag.value_id)) continue;

    // ถ้าเป็น multi-label attr → ไม่มาร์ค conflict แม้ rule จะมีค่าอื่นอยู่แล้ว
    if (MULTI_LABEL_ATTRS.has(tag.attribute)) {
      out.push(tag);
      continue;
    }

    // single-label attr → มาร์ค conflict ถ้า rule มีค่าอื่นอยู่
    out.push(ruleIds && ruleIds.length ? { ...tag, conflict: true } : tag);
  }
  return out;
}

/* ── cache ──────────────────────────────────────────────────── */

async function readCache(): Promise<Map<string, AiEnrichment>> {
  const map = new Map<string, AiEnrichment>();
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as CacheRow;
        if (row?.key && row?.ai) map.set(row.key, row.ai);
      } catch {
        /* ข้ามบรรทัดพัง */
      }
    }
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  return map;
}

async function writeCache(rows: CacheRow[]): Promise<void> {
  if (!rows.length) return;
  await fs.mkdir(DIR, { recursive: true });
  await fs.appendFile(
    CACHE_FILE,
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const all = raw.split(/\r?\n/).filter((l) => l.trim());
    if (all.length > MAX_CACHE_LINES) {
      await fs.writeFile(
        CACHE_FILE,
        `${all.slice(-MAX_CACHE_LINES).join("\n")}\n`,
        "utf8",
      );
    }
  } catch {
    /* prune ล้มเหลวไม่เป็นไร */
  }
}

/* ── cost (ประมาณ) ─────────────────────────────────────────── */

/** ราคา off-peak ต่อ 1M tokens (DeepSeek flash) — ใช้เพื่อ "ประมาณ" เท่านั้น */
export const DEEPSEEK_FLASH_PRICE = { cached: 0.003, input: 0.15, output: 0.6 };

function estimateCost(cfg: AiProviderConfig, tokens: AiTokenUsage): number {
  if (cfg.provider !== "deepseek") return 0;
  const missInput = Math.max(0, tokens.prompt - tokens.cached);
  const cost =
    (tokens.cached * DEEPSEEK_FLASH_PRICE.cached +
      missInput * DEEPSEEK_FLASH_PRICE.input +
      tokens.completion * DEEPSEEK_FLASH_PRICE.output) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/* ── main ───────────────────────────────────────────────────── */

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

export interface AiEnrichResult {
  stats: AiRunStats;
  updatedKeys: Set<string>;
}

/**
 * รวมแท็กรายการหนึ่งเข้ากับของเดิม โดยไม่ให้ (attribute, value_id) ซ้ำ
 * - เก็บ confidence ที่สูงกว่า / grounded ที่ดีกว่า / quote/region ที่มี
 * - ไม่ลบของเดิม (AI รอบก่อนหน้า + วลี + ภาพ อยู่ร่วมกันได้)
 */
export function mergeTagList(primary: AiTag[], secondary: AiTag[]): AiTag[] {
  const out = primary.map((t) => ({ ...t }));
  for (const tag of secondary) {
    const dup = out.find(
      (t) => t.attribute === tag.attribute && t.value_id === tag.value_id,
    );
    if (!dup) {
      out.push({ ...tag });
      continue;
    }
    dup.confidence = Math.max(dup.confidence, tag.confidence);
    dup.conflict = Boolean(dup.conflict || tag.conflict);
    if (!dup.grounded && tag.grounded) {
      dup.grounded = true;
      dup.quote = tag.quote;
      dup.evidence_type = tag.evidence_type ?? "text";
    }
    if (!dup.quote && tag.quote) dup.quote = tag.quote;
    if (!dup.region && tag.region) dup.region = tag.region;
    if (!dup.bbox && tag.bbox) dup.bbox = tag.bbox;
    if (!dup.image && tag.image) dup.image = tag.image;
  }
  return out;
}

/**
 * เก็บ `meta.vision` เดิมไว้เมื่อชั้นข้อความ/วลีเขียน meta ใหม่
 * - ถ้าไม่ทำ แถวที่อ่านภาพแล้ว แต่ถูก AI ข้อความเขียนทับ meta จะ "ลืม" ว่าเคยอ่านภาพ
 *   → ถูกส่งให้ VLM ซ้ำ (จ่ายเงินซ้ำ) และหลักฐานว่าค่าจากภาพไม่ถูกบันทึกไว้
 */
export function keepVisionMeta<T extends AiEnrichment["meta"]>(
  next: T,
  prev?: AiEnrichment["meta"],
): T {
  return prev?.vision ? { ...next, vision: prev.vision } : next;
}

/** แท็ก visual ที่มาจาก "ข้อความ" (AI เดา หรือวลี) ไม่ใช่หลักฐานจากภาพ */
function isTextVisualTag(t: AiTag): boolean {
  const fromText = t.origin === "ai" || t.origin === "phrase" || !t.origin;
  return fromText && VISUAL_ATTR_IDS.includes(t.attribute as AttrId);
}

/**
 * ทิ้งแท็ก visual ที่มาจากข้อความ เมื่อแถวนี้ "อ่านภาพแล้ว" (`meta.vision`)
 * - ภาพเป็นแหล่งเดียวของค่าที่มองเห็น: ถ้าอ่านภาพแล้วไม่พบ อย่าให้ข้อความเดาเพิ่ม
 * - แถวที่ยังไม่เคยอ่านภาพ → คงของเดิมไว้ (ยังไม่มีหลักฐานขัด)
 * - คืน array เดิม (identity) เมื่อไม่มีการเปลี่ยนแปลง → ผู้เรียกเช็คได้ด้วย `!==`
 */
export function stripTextVisualTags(
  tags: AiTag[],
  meta?: AiEnrichment["meta"],
): AiTag[] {
  if (!meta?.vision) return tags;
  if (!tags.some(isTextVisualTag)) return tags;
  return tags.filter((t) => !isTextVisualTag(t));
}

/** จำนวน "กลุ่ม attribute หลักที่กฎให้ข้อมูลได้แล้ว" (ใช้เป็นเกณฑ์ gate) */
export function evidenceFieldCount(p: NormalizedProduct): number {
  // นับเฉพาะ 2 กลุ่มที่ AI ถูกเรียกไปเติมจริง ๆ: ใช้ทำอะไร + ใช้ที่ไหน
  // (function/space/style ไม่นับ เพราะไม่ใช่เป้าหมายหลักของการเรียก AI)
  return [p.enrichment?.use_cases, p.enrichment?.contexts].filter(
    (list) => (list?.length ?? 0) > 0,
  ).length;
}

/**
 * เติม p.ai ให้สินค้า (mutate)
 * - cache ต่อ (provider+model+thinking+temperature+prompt+input)
 * - ผิดพลาดทั้ง batch → ข้าม ไม่ล้มทั้งงาน
 * - second pass เฉพาะแถวที่ยังไม่มี use_case + context
 */
/**
 * ชั้นที่ 0: เติมแท็กจากพจนานุกรมวลี (ไม่ต้องใช้ API — ทำงานได้แม้ไม่มี AI key)
 * ต้อง grounding ซ้ำในข้อความจริงทุกครั้ง (matchPhrases ทำหน้าที่นั้น)
 */
async function applyPhraseMemory(
  products: NormalizedProduct[],
  stats: AiRunStats,
  updatedKeys: Set<string>,
  at: string,
  /** ปลายทาง: เก็บ key ของแถวที่ได้ข้อมูล "จากวลีเท่านั้น" (ยังไม่มี AI ของจริง) */
  phraseOnly?: Set<string>,
): Promise<PhraseMap | null> {
  const loaded = await loadPhrases().catch(() => null);
  const phraseMap: PhraseMap | null =
    loaded?.map && loaded.map.size ? loaded.map : null;
  if (!phraseMap) return null;
  for (const p of products) {
    const matches = matchPhrases(p, phraseMap);
    if (!matches.length) continue;
    const valid = matches
      .map((m) => m.tag)
      .filter((t) => isValidValue(t.attribute as AttrId, t.value_id))
      // แถวนี้ "อ่านภาพแล้ว" → วลี (มาจากข้อความ) ไม่มีสิทธิ์เติมค่าที่เกี่ยวกับภาพ
      .filter(
        (t) =>
          !(
            p.ai?.meta?.vision &&
            VISUAL_ATTR_IDS.includes(t.attribute as AttrId)
          ),
      );
    if (!valid.length) continue;
    const reconciled = reconcileWithRules(valid, p);
    // แถวนี้ยังไม่มี AI ของจริง → วลีเป็นได้แค่ "ของชั่วคราว" ยังต้องส่ง AI ต่อ
    if (!p.ai) phraseOnly?.add(p.node_key);
    // ลำดับความสำคัญ: แท็กที่ AI/ภาพเคยให้ไว้ต้องคงอยู่ก่อน (หลักฐานตรงจากสินค้านั้น)
    // วลีเป็นเพียงตัวเติมช่องว่าง — ห้ามแทนที่ของเดิมหรือแย่งที่จนของเดิมหลุด
    const merged = mergeTagList(p.ai?.tags ?? [], reconciled);
    p.ai = {
      tags: merged.slice(0, MAX_TAGS_PER_RECORD),
      meta: keepVisionMeta(
        {
          provider: p.ai?.meta?.provider ?? "phrase-memory",
          model: p.ai?.meta?.model ?? PHRASE_VERSION,
          prompt_version: p.ai?.meta?.prompt_version ?? PHRASE_VERSION,
          at,
          status: "ok",
          // อย่าทำเครื่องหมาย cached ทับข้อมูลที่เพิ่งเรียกจริงในรอบก่อน
          cached: p.ai?.meta?.cached ?? true,
          phrase_version: PHRASE_VERSION,
        },
        p.ai?.meta,
      ),
    };
    stats.phrase_hits += valid.length;
    stats.updated += 1;
    updatedKeys.add(p.node_key);
  }
  return phraseMap;
}

export async function enrichWithAi(
  products: NormalizedProduct[],
  opts: {
    config?: Partial<PipelineConfig>;
    now?: Date;
    budgetMs?: number;
    secondPass?: boolean;
    /** true = ข้าม gate เรียก AI ทุกแถว (ใช้กับการสั่งซ้ำโดยผู้ใช้) */
    force?: boolean;
    /** เรียกทุกครั้งที่จบ batch — ใช้สตรีมความคืบหน้าให้ UI */
    onProgress?: (e: AiProgressEvent) => void;
    /** คืน true = หยุดหลัง batch ที่กำลังทำอยู่ (ผู้ใช้กดยกเลิก) */
    shouldStop?: () => boolean;
  } = {},
): Promise<AiEnrichResult> {
  const cfg = resolveAiConfig();
  const config = opts.config ?? {};
  const enabled = aiAvailable(config);
  const stats = emptyStats(cfg, enabled);
  const updatedKeys = new Set<string>();

  /**
   * invariant: "ค่าจากภาพต้องมาจากภาพ"
   * แถวที่อ่านภาพแล้ว → ทิ้งแท็ก visual ที่ AI/วลีเดาจากข้อความ (ค้างจากรอบก่อน)
   */
  const enforceVisionSoleSource = () => {
    for (const p of products) {
      if (!p.ai) continue;
      const tags = stripTextVisualTags(p.ai.tags, p.ai.meta);
      if (tags === p.ai.tags) continue;
      p.ai = { ...p.ai, tags };
      updatedKeys.add(p.node_key);
    }
  };

  /** Layer 3: sanitize AI/phrase tags + dedupe/hierarchy/evidence */
  const enforceAttributeRules = () => {
    const { changed } = validateEnrichment(products);
    for (const key of changed) updatedKeys.add(key);
  };

  if (!enabled) {
    // ยังมีประโยชน์: พจนานุกรมวลีไม่ต้องใช้ API
    if (config.phrase_memory !== false) {
      await applyPhraseMemory(
        products,
        stats,
        updatedKeys,
        (opts.now ?? new Date()).toISOString(),
      );
    }
    enforceVisionSoleSource();
    enforceAttributeRules();
    return { stats, updatedKeys };
  }

  const minConfidence = Math.max(
    0.3,
    Math.min(0.95, Number(config.ai_min_confidence ?? 0.55)),
  );
  const maxRecords = Math.max(
    0,
    Math.min(5000, Math.round(Number(config.ai_max_records_per_run ?? 150))),
  );
  const secondPass = opts.secondPass ?? true;
  const now = (opts.now ?? new Date()).toISOString();
  const deadline = Date.now() + Math.max(5000, opts.budgetMs ?? 120000);
  const gateMin = Math.max(
    0,
    Math.min(2, Math.round(Number(config.ai_gate_min_text_fields ?? 2))),
  );

  const inputs = products.map((p, i) => toInput(p, i));

  // ── ชั้นที่ 0: พจนานุกรมวลี (ฟรีกว่า AI แต่ต้อง grounding ซ้ำในข้อความจริง) ──
  const phraseOnly = new Set<string>();
  const phraseMap =
    config.phrase_memory !== false
      ? await applyPhraseMemory(products, stats, updatedKeys, now, phraseOnly)
      : null;
  enforceAttributeRules();

  const candidates = products
    .map((p, i) => ({ p, input: inputs[i] }))
    .filter(
      ({ p }) =>
        // force = ผู้ใช้สั่งเรียกซ้ำทุกแถว (ไม่สนว่ามีของเดิมแล้ว)
        opts.force === true ||
        !p.ai ||
        p.ai.meta?.status === "error" ||
        // แถวที่ยังมีแต่ค่าจากวลี (ไม่มี AI ของจริง) ต้องส่ง AI ต่อ
        phraseOnly.has(p.node_key) ||
        // แถวที่เคยถูกข้ามเพราะกฎครบ กลับมาเข้าเกณฑ์ได้ถ้าปิด gate
        (p.ai.meta?.status === "disabled" && gateMin === 0),
    );

  stats.requested = candidates.length;
  if (phraseMap) {
    stats.phrase_misses = candidates.filter(({ p }) =>
      (p.ai?.tags ?? []).every((t) => t.origin !== "phrase"),
    ).length;
  }

  // ── AI gating: กฎให้ข้อมูลครบแล้ว → ไม่ต้องจ่ายค่า AI เต็มรอบ ──
  const gateActive = gateMin > 0 && opts.force !== true;
  const gatedItems = gateActive
    ? candidates.filter(({ p }) => evidenceFieldCount(p) >= gateMin)
    : [];
  const processable = gateActive
    ? candidates.filter(({ p }) => evidenceFieldCount(p) < gateMin)
    : candidates;
  stats.gated = gatedItems.length;

  // บันทึกว่า "ตัดสินใจข้าม" เพื่อไม่ให้แถวพวกนี้ค้างเป็นงานที่ยังไม่ได้ทำตลอดไป
  // (ปิด gate แล้วรันใหม่ได้ — ตัวกรองด้านบนจะรับแถว status='disabled' กลับมา)
  for (const { p } of gatedItems) {
    p.ai = {
      // ค่าจากวลียังมีประโยชน์ — เก็บไว้ ไม่ล้างทิ้งตอนถูก gate
      tags: (p.ai?.tags ?? []).filter(
        (t) => t.origin === "phrase" || t.origin === "vision",
      ),
      meta: keepVisionMeta(
        {
          provider: cfg.provider,
          model: cfg.model,
          prompt_version: PROMPT_VERSION,
          at: now,
          status: "disabled",
          cached: false,
          phrase_version: PHRASE_VERSION,
          error: "gated_by_rules",
        },
        p.ai?.meta,
      ),
    };
    updatedKeys.add(p.node_key);
  }

  if (!processable.length) {
    // ไม่มีแถวให้เรียก AI — ไม่มีอะไรใหม่ให้เรียนรู้วลี
    enforceVisionSoleSource();
    enforceAttributeRules();
    stats.cost_usd = estimateCost(cfg, stats.tokens);
    return { stats, updatedKeys };
  }

  const cache = await readCache();
  const selected = processable.slice(0, maxRecords);
  stats.skipped = processable.length - selected.length;

  const toCall: Array<{ p: NormalizedProduct; input: AiInput; key: string }> =
    [];
  const newCacheRows: CacheRow[] = [];

  for (const item of selected) {
    const key = cacheKey(item.input);
    const hit = opts.force === true ? undefined : cache.get(key);
    if (hit) {
      // cache เก่าอาจมีค่าที่หลุด vocab/SEO/visual — กรองก่อน merge
      const valid = sanitizeAiTags(hit.tags ?? [], item.p);
      // เก็บของเดิม (เช่น แท็กจากวลี) ไว้ด้วย — แคชเป็นตัว "เติมเต็ม" ไม่ใช่ตัวเขียนทับ
      const tags = mergeTagList(valid, item.p.ai?.tags ?? []).slice(
        0,
        MAX_TAGS_PER_RECORD,
      );
      item.p.ai = {
        ...hit,
        tags,
        meta: keepVisionMeta({ ...hit.meta, cached: true }, item.p.ai?.meta),
      };
      stats.cached += 1;
      stats.updated += 1;
      updatedKeys.add(item.p.node_key);
    } else {
      toCall.push({ ...item, key });
    }
  }

  const startedAt = Date.now();
  let doneCount = stats.cached;
  let batchesDone = 0;
  let focusDone = 0;
  const emit = (
    phase: AiProgressEvent["phase"],
    extra: Partial<AiProgressEvent> = {},
  ) => {
    if (!opts.onProgress) return;
    opts.onProgress({
      phase,
      done: doneCount,
      total: selected.length,
      batches_done: batchesDone,
      batches_total: stats.batches,
      called: stats.called,
      cached: stats.cached,
      failed: stats.failed,
      tokens: { ...stats.tokens },
      cost_usd: estimateCost(cfg, stats.tokens),
      elapsed_ms: Date.now() - startedAt,
      ...extra,
    });
  };

  const batches: Array<typeof toCall> = [];
  for (let i = 0; i < toCall.length; i += cfg.batchSize)
    batches.push(toCall.slice(i, i + cfg.batchSize));

  const applyRows = (rows: any[], batch: typeof toCall, focus?: string[]) => {
    const byKey = new Map<string, any[]>();
    for (const row of rows) {
      if (row && typeof row.key === "string")
        byKey.set(row.key, Array.isArray(row.tags) ? row.tags : []);
    }
    for (const b of batch) {
      // ── CHANGELOG v3: รับ rejected_by_attr จาก validateAiTags ──
      const { tags, invalid, rejected_by_attr } = validateAiTags(
        byKey.get(b.input.key) ?? [],
        b.input,
        minConfidence,
      );
      stats.invalid += invalid;
      const reconciled = reconcileWithRules(tags, b.p);
      const merged = mergeTagList(reconciled, b.p.ai?.tags ?? []);
      const ai: AiEnrichment = {
        tags: merged.slice(0, MAX_TAGS_PER_RECORD),
        meta: keepVisionMeta(
          {
            provider: cfg.provider,
            model: cfg.model,
            prompt_version: PROMPT_VERSION,
            at: now,
            status: merged.length ? "ok" : "partial",
            cached: false,
            phrase_version: PHRASE_VERSION,
            // ── CHANGELOG v3: เก็บ validation stats ──
            validation: {
              rejected_vocab: 0, // TODO: แยกนับตาม reason ถ้าต้องการละเอียดขึ้น
              rejected_confidence: 0,
              rejected_grounded: 0,
              rejected_over_max: 0,
              rejected_by_attr: rejected_by_attr,
            },
          },
          b.p.ai?.meta,
        ),
      };
      b.p.ai = ai;
      stats.called += 1;
      stats.updated += 1;
      updatedKeys.add(b.p.node_key);
      if (!focus) newCacheRows.push({ key: b.key, at: now, ai });
    }
  };

  stats.batches += batches.length;
  emit("calling");
  await mapWithConcurrency(batches, cfg.concurrency, async (batch) => {
    if (opts.shouldStop?.()) return;
    const rows = await requestBatch(
      batch.map((b) => b.input),
      cfg,
      undefined,
      stats,
      deadline,
    );
    if (rows.length) applyRows(rows, batch);
    else {
      stats.failed += batch.length;
      for (const b of batch) {
        b.p.ai = {
          // อย่าล้างค่าจากวลีทิ้งเมื่อ AI ล้ม — ของเดิมยังใช้ได้
          tags: (b.p.ai?.tags ?? []).filter(
            (t) => t.origin === "phrase" || t.origin === "vision",
          ),
          meta: keepVisionMeta(
            {
              provider: cfg.provider,
              model: cfg.model,
              prompt_version: PROMPT_VERSION,
              at: now,
              status: "error",
              cached: false,
              error: stats.error,
            },
            b.p.ai?.meta,
          ),
        };
      }
    }
    doneCount += batch.length;
    batchesDone += 1;
    emit("calling");
  });

  const AI_ONLY_ATTRS = [
    "occasion",
    "adjustability",
    "power_source",
    "assembly",
    "finish",
  ];

  // ── CHANGELOG v2: focus pass สำหรับแถวที่ถูก Gate (ai_focus_ai_only) ──
  if (config.ai_focus_ai_only) {
    const gated = selected.filter(({ p }) => {
      const ai = p.ai?.tags ?? [];
      const hasAnyAiOnly = AI_ONLY_ATTRS.some((a) =>
        ai.some((t) => t.attribute === a),
      );
      return !hasAnyAiOnly;
    });
    if (gated.length) {
      stats.second_pass += gated.length;
      const gatedBatches: Array<typeof gated> = [];
      for (let i = 0; i < gated.length; i += cfg.batchSize)
        gatedBatches.push(gated.slice(i, i + cfg.batchSize));
      emit("second_pass", { focus_total: gated.length, focus_done: 0 });
      let gatedDone = 0;
      await mapWithConcurrency(gatedBatches, cfg.concurrency, async (batch) => {
        if (opts.shouldStop?.()) return;
        let rows: any[] = [];
        try {
          rows = await requestBatch(
            batch.map((b) => b.input),
            cfg,
            AI_ONLY_ATTRS,
            stats,
            deadline,
          );
        } catch {
          rows = [];
        }
        if (rows.length) {
          const byKey = new Map<string, any[]>();
          for (const row of rows) {
            if (row && typeof row.key === "string")
              byKey.set(row.key, Array.isArray(row.tags) ? row.tags : []);
          }
          for (const b of batch) {
            const raw = (byKey.get(b.input.key) ?? []).filter((t: any) =>
              AI_ONLY_ATTRS.includes(t?.attribute),
            );
            const { tags, invalid } = validateAiTags(
              raw,
              b.input,
              minConfidence,
            );
            stats.invalid += invalid;
            if (!tags.length) continue;
            const reconciled = reconcileWithRules(tags, b.p);
            const merged = [...(b.p.ai?.tags ?? []), ...reconciled];
            b.p.ai = {
              tags: merged.slice(0, MAX_TAGS_PER_RECORD),
              meta: {
                ...(b.p.ai?.meta ?? ({} as any)),
                at: now,
                status: "ok",
                cached: false,
              },
            };
            stats.updated += 1;
            updatedKeys.add(b.p.node_key);
          }
        }
        gatedDone += batch.length;
        emit("second_pass", {
          focus_total: gated.length,
          focus_done: gatedDone,
        });
      });
    }
  }

  // ── second pass: เฉพาะแถวที่ยังไม่มีทั้ง use case และ context ──
  if (secondPass) {
    // เดิม: ขาดทั้ง use_case และ context
    // ใหม่: ขาด use_case, context, adjustability, assembly, finish, power_source อย่างน้อย 2 ตัว
    const missing = selected.filter(({ p }) => {
      const ai = p.ai?.tags ?? [];
      const has = (attr: string) => ai.some((t) => t.attribute === attr);
      const missingCount =
        (has("use_case") ? 0 : 1) +
        (has("context") ? 0 : 1) +
        (has("adjustability") ? 0 : 1) +
        (has("assembly") ? 0 : 1) +
        (has("finish") ? 0 : 1) +
        (has("power_source") ? 0 : 1);
      return missingCount >= 2;
    });
    const focused = missing.slice(0, 40);
    if (focused.length) {
      stats.second_pass = focused.length;
      // CHANGELOG v2: เพิ่ม attribute ที่มักว่างใน Pass แรก
      const focusAttrs = [
        "use_case",
        "context",
        "audience",
        "adjustability", // ← เพิ่ม
        "assembly", // ← เพิ่ม
        "finish", // ← เพิ่ม
        "power_source", // ← เพิ่ม
      ];
      const focusBatches: Array<typeof focused> = [];
      for (let i = 0; i < focused.length; i += cfg.batchSize)
        focusBatches.push(focused.slice(i, i + cfg.batchSize));
      emit("second_pass", { focus_total: focused.length, focus_done: 0 });
      await mapWithConcurrency(focusBatches, cfg.concurrency, async (batch) => {
        if (opts.shouldStop?.()) return;
        let rows: any[] = [];
        try {
          rows = await requestBatch(
            batch.map((b) => b.input),
            cfg,
            focusAttrs,
            stats,
            deadline,
          );
        } catch {
          rows = [];
        }
        if (rows.length) {
          const byKey = new Map<string, any[]>();
          for (const row of rows) {
            if (row && typeof row.key === "string")
              byKey.set(row.key, Array.isArray(row.tags) ? row.tags : []);
          }
          for (const b of batch) {
            const raw = (byKey.get(b.input.key) ?? []).filter((t: any) =>
              focusAttrs.includes(t?.attribute),
            );
            const { tags, invalid } = validateAiTags(
              raw,
              b.input,
              minConfidence,
            );
            stats.invalid += invalid;
            if (!tags.length) continue;
            const reconciled = reconcileWithRules(tags, b.p);
            const merged = mergeTagList(reconciled, b.p.ai?.tags ?? []);
            b.p.ai = {
              tags: merged.slice(0, MAX_TAGS_PER_RECORD),
              meta: {
                ...(b.p.ai?.meta ?? ({} as any)),
                at: now,
                status: "ok",
                cached: false,
                phrase_version: PHRASE_VERSION,
              },
            };
            stats.updated += 1;
            updatedKeys.add(b.p.node_key);
          }
        }
        focusDone += batch.length;
        emit("second_pass", {
          focus_total: focused.length,
          focus_done: focusDone,
        });
      });
    }
  }

  if (config.ai_focus_ai_only === true && gatedItems.length) {
    const focused = gatedItems.slice(0, Math.min(60, maxRecords));
    if (focused.length) {
      stats.focus_pass = focused.length;
      const focusBatches: Array<typeof focused> = [];
      for (let i = 0; i < focused.length; i += cfg.batchSize) {
        focusBatches.push(focused.slice(i, i + cfg.batchSize));
      }
      let focus2Done = 0;
      emit("focus", { focus_total: focused.length, focus_done: 0 });
      await mapWithConcurrency(focusBatches, cfg.concurrency, async (batch) => {
        if (opts.shouldStop?.()) return;
        let rows: any[] = [];
        try {
          rows = await requestBatch(
            batch.map((b) => b.input),
            cfg,
            AI_ONLY_ATTRS,
            stats,
            deadline,
          );
        } catch {
          rows = [];
        }
        if (rows.length) {
          const byKey = new Map<string, any[]>();
          for (const row of rows) {
            if (row && typeof row.key === "string")
              byKey.set(row.key, Array.isArray(row.tags) ? row.tags : []);
          }
          for (const b of batch) {
            const raw = (byKey.get(b.input.key) ?? []).filter((t: any) =>
              AI_ONLY_ATTRS.includes(t?.attribute),
            );
            const { tags, invalid } = validateAiTags(
              raw,
              b.input,
              minConfidence,
            );
            stats.invalid += invalid;
            if (!tags.length) continue;
            const reconciled = reconcileWithRules(tags, b.p);
            const merged = mergeTagList(reconciled, b.p.ai?.tags ?? []);
            b.p.ai = {
              tags: merged.slice(0, MAX_TAGS_PER_RECORD),
              meta: keepVisionMeta(
                {
                  provider: cfg.provider,
                  model: cfg.model,
                  prompt_version: PROMPT_VERSION,
                  at: now,
                  status: "ok",
                  cached: false,
                  phrase_version: PHRASE_VERSION,
                },
                b.p.ai?.meta,
              ),
            };
            stats.updated += 1;
            updatedKeys.add(b.p.node_key);
          }
        }
        focus2Done += batch.length;
        emit("focus", { focus_total: focused.length, focus_done: focus2Done });
      });
    }
  }

  // ── ปิดท้าย: ให้ "ค่าจากภาพมาจากภาพเท่านั้น" ก่อนเรียนรู้วลี ──
  enforceVisionSoleSource();

  // ── เรียนรู้วลีจากผลรอบนี้ (เฉพาะ quote ที่ grounded แล้ว และเพิ่งสร้างในรอบนี้) ──
  enforceVisionSoleSource();
  enforceAttributeRules();
  if (config.phrase_memory !== false) {
    const fresh = products.filter(
      (p) =>
        updatedKeys.has(p.node_key) &&
        p.ai != null &&
        p.ai.meta.cached !== true,
    );
    await harvestPhrases(fresh).catch(() => undefined);
  }

  stats.cost_usd = estimateCost(cfg, stats.tokens);
  await writeCache(newCacheRows);
  return { stats, updatedKeys };
}

export type { AiInput };
