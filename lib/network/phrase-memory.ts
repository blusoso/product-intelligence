/**
 * Phrase Memory — พจนานุกรมวลีที่เรียนรู้จากผล AI (และใช้ซ้ำอย่างปลอดภัย)
 * ----------------------------------------------------------------------
 * แนวคิด: quote ที่ AI อ้างแล้ว "ตรวจผ่าน" ในสินค้าหนึ่ง มีโอกาสสูงที่จะใช้ได้กับ
 *         สินค้าอื่นที่ใช้ถ้อยคำเดียวกัน → ไม่ต้องจ่ายค่า AI ซ้ำสำหรับวลีเดิม
 *
 * เงื่อนไขเหล็ก (ห้ามข้าม):
 *  1) ทุกครั้งที่จับวลีได้ ต้องสแกนหาวลีนั้นใน "ข้อความจริงของสินค้าคันนี้" ซ้ำ
 *     ถ้าเจอ → สร้างแท็กด้วย substring จริงที่พบ, grounded=true, origin='phrase'
 *     ถ้าไม่เจอ → ไม่ใช้ (ปล่อยให้ AI ทำงาน)
 *  2) ค่าต้องอยู่ใน vocabulary กลาง (enum-only)
 *  3) วลีกว้าง/กำกวมต้องถูกบล็อก — ใช้ความยาวขั้นต่ำ + generic blocklist + เงื่อนไขหมวดหมู่
 *  4) วลีที่ถูกปฏิเสธบ่อยจะถูก block (กันการแพร่ของค่าผิด)
 *
 * ที่เก็บ: ตาราง enrichment_phrases (Supabase) → ถ้าใช้ไม่ได้ fallback ไฟล์
 *         data/network/phrases.jsonl (best-effort, ไม่ทำให้ pipeline ล้ม)
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { AiTag, NormalizedProduct } from './types';
import { ATTRIBUTE_MAP, isValidValue, valueLabel, VISUAL_ATTR_IDS, type AttrId } from './vocab';
import { normalizeForMatch, normalizeForModel } from './normalize-text';
import { isSeoAmbiguousPhrase } from './seo-keywords';
import { PRODUCT_TYPES } from './taxonomy';

export const PHRASE_VERSION = 'phrase-v2';

const DIR = path.join(process.cwd(), 'data', 'network');
export const PHRASE_FILE = path.join(DIR, 'phrases.jsonl');
export const MAX_PHRASES = 5000;

/** ความยาวขั้นต่ำของวลี (ไทยนับเป็นตัวอักษร, อังกฤษนับเป็นคำ-ish) */
const MIN_LEN_TH = 4;
const MIN_LEN_ASCII = 5;
const MAX_PHRASE_LEN = 40;
/** จำนวนครั้งขั้นต่ำที่เจอ ก่อนเลื่อนจาก candidate → active */
export const MIN_OBSERVATIONS = 2;
export const MIN_ACCEPT_RATIO = 0.8;
export const MAX_REJECT_RATIO = 0.3;
/** วลีสั้นกว่านี้ต้องมีหมวดหมู่ตรงกันเท่านั้นจึงจะใช้ */
const SHORT_PHRASE_LEN = 8;
/** attribute ที่คำกว้าง ๆ ทำให้ความหมายเพี้ยนได้ง่าย */
const CATEGORY_SENSITIVE: AttrId[] = ['use_case', 'context', 'function', 'visual_features'];

/** คำกว้าง/คำโฆษณาที่ "ห้าม" ถูกใช้เป็นวลีเดี่ยว ๆ */
const GENERIC = new Set([
  'โต๊ะ', 'เก้าอี้', 'ชั้น', 'ตู้', 'กล่อง', 'ตะกร้า', 'โคม', 'ไฟ', 'หลอด', 'พรม',
  'หมอน', 'ผ้า', 'ไม้', 'เหล็ก', 'พลาสติก', 'ของ', 'บ้าน', 'ห้อง', 'สินค้า',
  'ขนาด', 'สี', 'ชิ้น', 'ตัว', 'แบบ', 'รุ่น', 'ใหม่', 'มือ', 'ส่ง', 'ฟรี',
  'พร้อมส่ง', 'ลดราคา', 'ราคาถูก', 'ของแท้', 'คุณภาพ', 'พรีเมียม', 'สวย',
  'set', 'new', 'hot', 'sale', 'free', 'good', 'quality', 'product', 'item',
  'home', 'room', 'desk', 'table', 'lamp', 'chair', 'storage', 'size', 'color',
  'เด็ก', 'ญี่ปุ่น', 'เกาหลี', 'มูจิ', 'มินิมอล', 'มินิมัล',
]);

/** คำที่เป็น product type / audience / context ตรงตัว — ใช้ห้ามจำข้าม attribute */
const TYPE_KEYWORDS = new Set(
  PRODUCT_TYPES.flatMap((t) => t.keywords.map((kw) => normalizeForMatch(kw))),
);
const audienceDef = ATTRIBUTE_MAP.audience;
const contextDef = ATTRIBUTE_MAP.context;
const AUDIENCE_KEYWORDS = new Set(
  audienceDef.values.flatMap((v) => [...v.th, ...v.en].map((kw) => normalizeForMatch(kw))),
);
const CONTEXT_KEYWORDS = new Set(
  contextDef.values.flatMap((v) => [...v.th, ...v.en].map((kw) => normalizeForMatch(kw))),
);

export interface PhraseEntry {
  phrase_key: string;
  phrase: string;
  attribute: AttrId;
  value_id: string;
  value_label: string;
  /** หมวดหมู่ที่พบวลีนี้ (null = ใช้ได้ทุกหมวด) */
  category: string | null;
  product_type: string | null;
  observations: number;
  accept: number;
  reject: number;
  confidence: number;
  status: 'candidate' | 'active' | 'blocked';
  origin: 'ai' | 'vision' | 'phrase' | 'manual';
  first_seen: string;
  last_seen: string;
}

export type PhraseMap = Map<string, PhraseEntry>;

export interface PhraseStats {
  total: number;
  active: number;
  candidate: number;
  blocked: number;
  /** entry ที่ถูกกรองทิ้งเพราะผิด policy (SEO/คำกว้าง/ผิด role) */
  ignored: number;
  /** ที่เก็บที่อ่านสำเร็จ */
  store: 'db' | 'file' | 'none';
}

const phraseKey = (attribute: string, valueId: string, category: string | null | undefined, phrase: string) =>
  `${attribute}|${valueId}|${category || '*'}||${phrase}`;

const now = () => new Date().toISOString();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/* ── กติกาวลี ────────────────────────────────────────────────── */

/** วลีนี้ "กว้างเกินไป" หรือไม่ (ใช้ตอน harvest และตอนโหลด) */
export function isAmbiguousPhrase(phrase: string, attribute: AttrId): boolean {
  if (!ATTRIBUTE_MAP[attribute]) return true;
  // ค่าที่ต้องมาจากภาพเท่านั้น — ข้อความยืนยันไม่ได้
  if (VISUAL_ATTR_IDS.includes(attribute)) return true;
  const p = normalizeForMatch(phrase);
  if (!p) return true;
  if (isSeoAmbiguousPhrase(p)) return true;
  if (p.length < (isAsciiOnly(p) ? MIN_LEN_ASCII : MIN_LEN_TH)) return true;
  if (p.length > MAX_PHRASE_LEN) return true;
  if (GENERIC.has(p)) return true;
  // วลีที่ไม่มีตัวอักษรเลย (เช่น "1.2", "++")
  if (!/[\p{L}]/u.test(p)) return true;
  // คำที่เป็น product type ตรงตัว ไม่ควรถูกจำไปเป็น attribute ใด ๆ
  if (TYPE_KEYWORDS.has(p)) return true;
  // คำ audience/context ตรงตัว ต้องอยู่กับ attribute ของตัวเองเท่านั้น
  if (AUDIENCE_KEYWORDS.has(p) && attribute !== 'audience') return true;
  if (CONTEXT_KEYWORDS.has(p) && attribute !== 'context') return true;
  return false;
}

function isAsciiOnly(s: string): boolean {
  return /^[a-z0-9 _-]+$/.test(s);
}

/** คะแนนความมั่นใจของวลีที่เจอซ้ำ (ยิ่งเจอบ่อยยิ่งมั่นใจ แต่ไม่เกิน 0.85) */
export function phraseConfidence(observations: number): number {
  return Math.round(clamp(0.6 + 0.1 * Math.log2(Math.max(1, observations)), 0.6, 0.85) * 100) / 100;
}

function nextStatus(entry: Pick<PhraseEntry, 'observations' | 'accept' | 'reject'>): PhraseEntry['status'] {
  const total = entry.accept + entry.reject;
  if (!total) return 'candidate';
  const rejectRatio = entry.reject / total;
  if (rejectRatio > MAX_REJECT_RATIO) return 'blocked';
  if (entry.observations >= MIN_OBSERVATIONS && entry.accept / total >= MIN_ACCEPT_RATIO) return 'active';
  return 'candidate';
}

/* ── ที่เก็บ: DB ก่อน, ไฟล์เป็น fallback ─────────────────────── */

const ROW_COLUMNS =
  'phrase_key,phrase,attribute,value_id,value_label,category,product_type,observations,accept,reject,confidence,status,origin,first_seen,last_seen';

function toEntry(row: any): PhraseEntry | null {
  if (!row?.phrase_key) return null;
  const attribute = String(row.attribute ?? '') as AttrId;
  if (!row.value_id || !isValidValue(attribute, row.value_id)) return null;
  return {
    phrase_key: String(row.phrase_key),
    phrase: String(row.phrase ?? ''),
    attribute,
    value_id: String(row.value_id),
    value_label: String(row.value_label ?? valueLabel(attribute, String(row.value_id))),
    category: row.category ? String(row.category) : null,
    product_type: row.product_type ? String(row.product_type) : null,
    observations: Number(row.observations ?? 0),
    accept: Number(row.accept ?? 0),
    reject: Number(row.reject ?? 0),
    confidence: Number(row.confidence ?? 0.6),
    status: (['candidate', 'active', 'blocked'].includes(String(row.status))
      ? String(row.status)
      : 'candidate') as PhraseEntry['status'],
    origin: (['ai', 'vision', 'phrase', 'manual'].includes(String(row.origin))
      ? String(row.origin)
      : 'ai') as PhraseEntry['origin'],
    first_seen: String(row.first_seen ?? now()),
    last_seen: String(row.last_seen ?? now()),
  };
}

/** โหลดวลีทั้งหมด (DB → ไฟล์). ไม่ throw */
export async function loadPhrases(): Promise<{ map: PhraseMap; stats: PhraseStats }> {
  const map: PhraseMap = new Map();
  let store: PhraseStats['store'] = 'none';
  let ignored = 0;

  const accept = (entry: PhraseEntry | null) => {
    if (!entry) return;
    // entry เก่าที่ผิด policy ใหม่ (SEO/คำกว้าง/ผิด role/visual) → ไม่โหลด
    if (isAmbiguousPhrase(entry.phrase, entry.attribute)) {
      ignored += 1;
      return;
    }
    map.set(entry.phrase_key, entry);
  };

  try {
    const { supabase } = await import('@/lib/supabase');
    const { data, error } = await supabase
      .from('enrichment_phrases')
      .select(ROW_COLUMNS)
      .order('last_seen', { ascending: false })
      .limit(MAX_PHRASES);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        accept(toEntry(row));
      }
      store = 'db';
    }
  } catch {
    /* ไม่มี DB / ยังไม่ apply migration → ลองไฟล์ */
  }

  if (store !== 'db') {
    try {
      const raw = await fs.readFile(PHRASE_FILE, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          accept(toEntry(JSON.parse(line)));
        } catch {
          /* ข้ามบรรทัดพัง */
        }
      }
      store = map.size ? 'file' : 'none';
    } catch {
      store = 'none';
    }
  }

  let active = 0;
  let candidate = 0;
  let blocked = 0;
  for (const e of map.values()) {
    if (e.status === 'active') active += 1;
    else if (e.status === 'blocked') blocked += 1;
    else candidate += 1;
  }
  return { map, stats: { total: map.size, active, candidate, blocked, ignored, store } };
}

/** บันทึก/อัปเดตวลี (upsert). best-effort — ไม่ throw
 *  mode='accumulate' (ค่าเริ่มต้น) = บวกยอดกับของเดิม (ใช้ตอน harvest)
 *  mode='replace'             = เขียนทับค่าที่ให้มา (ใช้ตอนปรับยอดจาก conflict review)
 */
export async function savePhrases(
  entries: PhraseEntry[],
  opts: { mode?: 'accumulate' | 'replace' } = {},
): Promise<{ persisted: 'db' | 'file' | 'none'; error?: string }> {
  if (!entries.length) return { persisted: 'none' };
  const mode = opts.mode ?? 'accumulate';
  try {
    const { supabase } = await import('@/lib/supabase');
    const rows = entries.map((e) => ({ ...e, last_seen: now() }));
    if (mode === 'replace') {
      const { error } = await supabase.from('enrichment_phrases').upsert(rows, { onConflict: 'phrase_key' });
      if (!error) return { persisted: 'db' };
      // ตารางยังไม่ถูก apply / DB มีปัญหา → ให้ตกไปเขียนไฟล์ด้านล่าง
      throw new Error(error.message);
    }
    // upsert รวมยอด: ต้องอ่านของเดิมก่อนเพื่อไม่ให้ observations หาย
    const { data: existing } = await supabase
      .from('enrichment_phrases')
      .select(ROW_COLUMNS)
      .in(
        'phrase_key',
        rows.map((r) => r.phrase_key),
      );
    const prev = new Map<string, PhraseEntry>();
    for (const row of existing ?? []) {
      const entry = toEntry(row);
      if (entry) prev.set(entry.phrase_key, entry);
    }
    const merged = rows.map((r) => {
      const old = prev.get(r.phrase_key);
      if (!old) return r;
      const observations = old.observations + r.observations;
      const accept = old.accept + r.accept;
      const reject = old.reject + r.reject;
      return {
        ...r,
        observations,
        accept,
        reject,
        confidence: Math.max(old.confidence, phraseConfidence(observations)),
        status: nextStatus({ observations, accept, reject }),
        first_seen: old.first_seen,
        last_seen: now(),
      };
    });
    const { error } = await supabase.from('enrichment_phrases').upsert(merged, { onConflict: 'phrase_key' });
    if (!error) return { persisted: 'db' };
    throw new Error(error.message);
  } catch {
    /* ตกไปเขียนไฟล์ */
  }

  try {
    await fs.mkdir(DIR, { recursive: true });
    // อ่านของเดิมมารวมยอดก่อน (โหมดไฟล์ต้อง accumulate เหมือนโหมด DB)
    const map = new Map<string, PhraseEntry>();
    try {
      const raw = await fs.readFile(PHRASE_FILE, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = toEntry(JSON.parse(line));
          if (entry) map.set(entry.phrase_key, entry);
        } catch {
          /* ข้ามบรรทัดพัง */
        }
      }
    } catch {
      /* ยังไม่มีไฟล์ */
    }
    for (const e of entries) {
      const prev = map.get(e.phrase_key);
      if (!prev || mode === 'replace') {
        map.set(e.phrase_key, { ...e, last_seen: now() });
        continue;
      }
      const observations = prev.observations + e.observations;
      const accept = prev.accept + e.accept;
      const reject = prev.reject + e.reject;
      map.set(e.phrase_key, {
        ...e,
        observations,
        accept,
        reject,
        confidence: Math.max(prev.confidence, phraseConfidence(observations)),
        status: nextStatus({ observations, accept, reject }),
        first_seen: prev.first_seen,
        last_seen: now(),
      });
    }
    const all = [...map.values()].slice(-MAX_PHRASES);
    await fs.writeFile(PHRASE_FILE, `${all.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
    return { persisted: 'file' };
  } catch (e: any) {
    return { persisted: 'none', error: e?.message || String(e) };
  }
}

/* ── เรียนรู้จากผล AI ──────────────────────────────────────── */

interface HarvestHit {
  phrase: string;
  attribute: AttrId;
  value_id: string;
  value_label: string;
  category: string | null;
  product_type: string | null;
  origin: PhraseEntry['origin'];
}

/** เก็บวลีจากแท็กที่ "grounded ด้วย quote" เท่านั้น (ไม่เรียนจากภาพ/การอนุมาน) */
export function harvestFromProduct(p: NormalizedProduct): HarvestHit[] {
  const out: HarvestHit[] = [];
  if (!p.ai?.tags?.length) return out;
  const category = p.category && p.category !== 'other' ? p.category : null;
  const productType = p.product_type && p.product_type !== 'other' ? p.product_type : null;

  for (const tag of p.ai.tags) {
    if (!tag.grounded || !tag.quote) continue;
    if (tag.evidence_type === 'image') continue; // วลีจากภาพใช้ไม่ได้กับข้อความ
    if (tag.origin === 'phrase') continue; // ไม่เรียนจากสิ่งที่ตัวเองสร้าง
    const attribute = tag.attribute as AttrId;
    if (!isValidValue(attribute, tag.value_id)) continue;
    // ค่าที่ต้องมาจากภาพเท่านั้น — ข้อความยืนยันไม่ได้
    if (VISUAL_ATTR_IDS.includes(attribute)) continue;
    if (isAmbiguousPhrase(tag.quote, attribute)) continue;
    out.push({
      phrase: normalizeForMatch(tag.quote),
      attribute,
      value_id: tag.value_id,
      value_label: valueLabel(attribute, tag.value_id),
      category,
      product_type: productType,
      origin: 'ai',
    });
  }
  return out;
}

/**
 * เรียนรู้วลีจากสินค้าหนึ่งชุด แล้วบันทึก
 * - เรียกได้บ่อยเท่าที่ต้องการ (upsert รวมยอด ไม่ซ้ำ)
 */
export async function harvestPhrases(
  products: NormalizedProduct[],
): Promise<{ hits: number; saved: number; persisted: 'db' | 'file' | 'none'; error?: string }> {
  const seen = new Map<string, PhraseEntry>();
  const stamp = now();

  for (const p of products) {
    for (const hit of harvestFromProduct(p)) {
      const key = phraseKey(hit.attribute, hit.value_id, hit.category, hit.phrase);
      const prev = seen.get(key);
      if (prev) {
        prev.observations += 1;
        prev.accept += 1;
        continue;
      }
      seen.set(key, {
        phrase_key: key,
        phrase: hit.phrase,
        attribute: hit.attribute,
        value_id: hit.value_id,
        value_label: hit.value_label,
        category: hit.category,
        product_type: hit.product_type,
        observations: 1,
        accept: 1,
        reject: 0,
        confidence: phraseConfidence(1),
        status: 'candidate',
        origin: hit.origin,
        first_seen: stamp,
        last_seen: stamp,
      });
    }
  }

  const entries = [...seen.values()];
  if (!entries.length) return { hits: 0, saved: 0, persisted: 'none' };
  for (const e of entries) e.status = nextStatus(e);
  const res = await savePhrases(entries);
  return { hits: entries.length, saved: res.persisted === 'none' ? 0 : entries.length, ...res };
}

/* ── จับคู่กับสินค้าใหม่ (ต้อง grounding ซ้ำทุกครั้ง) ──────── */

export interface PhraseMatch {
  tag: AiTag;
  entry: PhraseEntry;
}

function canApply(entry: PhraseEntry, p: NormalizedProduct): boolean {
  const sameCategory = entry.category != null && entry.category === p.category;
  const sameType = entry.product_type != null && entry.product_type === p.product_type;
  if (entry.category == null && entry.product_type == null) {
    // วลีกว้างที่ไม่มีเงื่อนไขหมวด → ใช้ได้เฉพาะวลีที่ยาวพอ
    return !(CATEGORY_SENSITIVE.includes(entry.attribute) && entry.phrase.length < SHORT_PHRASE_LEN);
  }
  return sameCategory || sameType;
}

/** ข้อความที่ใช้จับวลี (เหมือนที่ส่งให้ AI: ชื่อ + สเปก + ตัวเลือก + รายละเอียด) */
export function matchText(p: NormalizedProduct): { normalized: string; lowered: string } {
  const normalized = normalizeForModel(
    [
      p.name,
      ...(p.specs ?? []).map((s) => `${s.name} ${s.value}`),
      ...(p.variants ?? []).map((v) => String(v.name ?? v.model_id ?? '')),
      p.description ?? '',
    ].join(' '),
  );
  return { normalized, lowered: normalized.toLowerCase() };
}

/**
 * หาแท็กจากพจนานุกรมวลี — คืนเฉพาะวลีที่ "สแกนเจอในข้อความจริง"
 * ผู้เรียกต้องเอาไป validate (vocab) + reconcileWithRules ต่อ
 */
export function matchPhrases(
  p: NormalizedProduct,
  map: PhraseMap,
  opts: { limit?: number; text?: { normalized: string; lowered: string } } = {},
): PhraseMatch[] {
  if (!map.size) return [];
  const text = opts.text ?? matchText(p);
  if (!text.lowered) return [];
  const limit = Math.max(1, Math.min(8, opts.limit ?? 6));
  const out: PhraseMatch[] = [];
  // วลียิ่งยาวยิ่งเฉพาะเจาะจง → ลองก่อน (กันวลีสั้นแย่งที่)
  const entries = [...map.values()]
    .filter((e) => e.status === 'active' && canApply(e, p))
    .sort((a, b) => b.phrase.length - a.phrase.length);

  const used = new Set<string>();
  for (const entry of entries) {
    const idx = text.lowered.indexOf(entry.phrase);
    if (idx < 0) continue;
    const dedupeKey = `${entry.attribute}|${entry.value_id}`;
    if (used.has(dedupeKey)) continue;
    // ตัด substring จริงจากข้อความที่คงตัวพิมพ์ (ถ้าความยาวไม่เปลี่ยนจากการ lowercase)
    const quote =
      text.normalized.length === text.lowered.length
        ? text.normalized.slice(idx, idx + entry.phrase.length)
        : entry.phrase;
    used.add(dedupeKey);
    out.push({
      entry,
      tag: {
        attribute: entry.attribute,
        value_id: entry.value_id,
        value: entry.value_label || valueLabel(entry.attribute, entry.value_id),
        confidence: Math.min(entry.confidence, phraseConfidence(entry.observations)),
        grounded: true,
        quote,
        origin: 'phrase',
        evidence_type: 'text',
      },
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** ปรับยอด accept/reject ของวลี (ใช้เมื่อคนตรวจ conflict แล้วตัดสิน) */
export async function adjustPhrase(
  phraseKeyValue: string,
  delta: 'accept' | 'reject',
): Promise<{ ok: boolean; error?: string }> {
  const { map } = await loadPhrases();
  const entry = map.get(phraseKeyValue);
  if (!entry) return { ok: false, error: 'ไม่พบวลีนี้' };
  const accept = entry.accept + (delta === 'accept' ? 1 : 0);
  const reject = entry.reject + (delta === 'reject' ? 1 : 0);
  const observations = entry.observations + 1;
  const next: PhraseEntry = {
    ...entry,
    accept,
    reject,
    observations,
    status: nextStatus({ observations, accept, reject }),
    last_seen: now(),
  };
  const res = await savePhrases([next], { mode: 'replace' });
  return res.persisted === 'none' ? { ok: false, error: res.error } : { ok: true };
}

export { phraseKey };
