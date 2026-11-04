/**
 * Conflict Resolution — เมื่อ "ค่าที่ AI ให้" ขัดกับ "หลักฐานที่ตรวจได้"
 * --------------------------------------------------------------------
 * กติกา:
 *  - rule/evidence ยังเป็นตัวจริงเสมอ (ห้ามให้ AI เขียนทับ)
 *  - แต่ถ้าเป็น attribute ที่กระทบการใช้งานจริง (พับได้ / มีร่องวางแท็บเล็ต / แหล่งพลังงาน)
 *    ต้องส่งเข้าคิวให้คนตัดสิน ไม่ปล่อยให้ค้างในรายงานเฉย ๆ
 *  - idempotent: รัน pipeline ซ้ำไม่สร้างแถวใหม่ (UNIQUE ext+attribute+value_id)
 *  - คำตัดสินของคนไม่ถูกเขียนทับ: resolved_* จะถูกข้ามตลอด
 *
 * ที่เก็บ: ตาราง enrichment_conflicts (Supabase) → fallback data/network/conflicts.jsonl
 */
import type { AiTag, NormalizedProduct } from './types';
import { valueLabel, type AttrId } from './vocab';
import { normalizeForMatch } from './normalize-text';
import { adjustPhrase, phraseKey } from './phrase-memory';

export const CONFLICT_FILE = 'conflicts.jsonl';

/** attribute ที่กระทบการใช้งานจริง — ถ้าขัดกันให้เป็น critical */
export const WATCH_ATTRS: AttrId[] = [
  'adjustability',
  'power_source',
  'assembly',
  'function',
  'visual_features',
  'material_visual',
];

const RULE_ATTRS: Array<[AttrId, keyof NormalizedProduct['enrichment']]> = [
  ['use_case', 'use_cases'],
  ['function', 'functions'],
  ['context', 'contexts'],
  ['style', 'styles'],
  ['space', 'spaces'],
  ['audience', 'audiences'],
];

export interface ConflictCandidate {
  ext: string;
  product_id: number | null;
  attribute: AttrId;
  value_id: string;
  value_label: string;
  /** ค่าที่หลักฐานบอกว่าเป็น (ถ้ามี) */
  rule_values: string[];
  ai_confidence: number;
  ai_quote: string | null;
  evidence_type: 'text' | 'image';
  severity: 'warning' | 'critical';
  reason: string;
  /** ถ้าแท็กที่ขัดมาจากพจนานุกรมวลี — ใช้ปรับยอด accept/reject ตอนคนตัดสิน */
  phrase_key: string | null;
}

export type ConflictStatus = 'pending' | 'resolved_rule' | 'resolved_ai' | 'dismissed';

export interface ConflictRow extends ConflictCandidate {
  id: number;
  status: ConflictStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  note: string | null;
}

export const conflictKey = (c: { ext: string; attribute: string; value_id: string }) =>
  `${c.ext}|${c.attribute}|${c.value_id}`;

/* ── ตัวตรวจ ───────────────────────────────────────────────── */

function ruleValuesOf(p: NormalizedProduct, attribute: AttrId): string[] {
  for (const [attr, key] of RULE_ATTRS) {
    if (attr !== attribute) continue;
    const list = p.enrichment?.[key];
    return Array.isArray(list) ? list.map((t: any) => String(t.id)) : [];
  }
  return [];
}

/** ข้อความบอกว่า "ไม่มี/without" สิ่งนั้น ก่อนหน้าคำที่ AI อ้างหรือไม่ */
function looksNegated(text: string, quote: string | undefined): boolean {
  if (!quote) return false;
  const hay = normalizeForMatch(text);
  const q = normalizeForMatch(quote);
  if (!q) return false;
  const idx = hay.indexOf(q);
  if (idx < 0) return false;
  const before = hay.slice(Math.max(0, idx - 14), idx);
  return /(ไม่มี|ไม่ต้อง|ไม่\s|without|no\s|not\s)/.test(before);
}

interface Implied {
  attribute: AttrId;
  value_id: string;
  reason: string;
  test: (p: NormalizedProduct, text: string) => boolean;
}

/** หลักฐานที่บอกเป็นนัยว่าควรเป็นค่าหนึ่ง — ถ้า AI ให้ "ไม่มี/none" ถือว่าขัด */
const IMPLIED: Implied[] = [
  {
    attribute: 'adjustability',
    value_id: 'foldable',
    reason: 'ข้อความบอกว่าพับได้',
    test: (_p, text) => /พับได้|พับเก็บ|foldable|folding/.test(text),
  },
  {
    attribute: 'adjustability',
    value_id: 'height',
    reason: 'ข้อความบอกว่าปรับระดับได้',
    test: (_p, text) => /ปรับระดับ|ปรับสูง|height adjustable/.test(text),
  },
  {
    attribute: 'power_source',
    value_id: 'plug',
    reason: 'ข้อความบอกว่าต้องเสียบปลั๊ก',
    test: (_p, text) => /ปลั๊ก|เสียบไฟ|plug-in/.test(text),
  },
];

function productText(p: NormalizedProduct): string {
  return [
    p.name,
    ...(p.specs ?? []).map((s) => `${s.name} ${s.value}`),
    ...(p.variants ?? []).map((v) => String(v.name ?? v.model_id ?? '')),
    p.description ?? '',
  ].join(' ');
}

/**
 * หาความขัดแย้งของสินค้า 1 ชิ้น (pure — ไม่มี I/O ใช้ใน audit ได้)
 * แหล่งที่มา 3 ทาง:
 *   1) แท็กที่ reconcileWithRules mark conflict ไว้แล้ว
 *   2) หลักฐานบอกเป็นนัย (IMPLIED) แต่ AI ให้ค่า "ไม่มี/none"
 *   3) ข้อความบอกว่า "ไม่มี" สิ่งที่ AI อ้างว่ามี
 */
export function detectConflicts(p: NormalizedProduct): ConflictCandidate[] {
  const tags: AiTag[] = p.ai?.tags ?? [];
  if (!tags.length) return [];
  const text = productText(p);
  const out: ConflictCandidate[] = [];
  const ruleOf = (attr: AttrId) => ruleValuesOf(p, attr);

  const push = (tag: AiTag, ruleValues: string[], reason: string) => {
    const attribute = tag.attribute as AttrId;
    out.push({
      ext: p.ext,
      product_id: p.product_id ? Number(p.product_id) || null : null,
      attribute,
      value_id: tag.value_id,
      value_label: tag.value || valueLabel(attribute, tag.value_id),
      rule_values: ruleValues,
      ai_confidence: tag.confidence,
      ai_quote: tag.quote ?? null,
      evidence_type: tag.evidence_type === 'image' ? 'image' : 'text',
      severity: WATCH_ATTRS.includes(attribute) ? 'critical' : 'warning',
      reason,
      phrase_key:
        tag.origin === 'phrase' && tag.quote
          ? phraseKey(attribute, tag.value_id, p.category && p.category !== 'other' ? p.category : null, normalizeForMatch(tag.quote))
          : null,
    });
  };

  for (const tag of tags) {
    if (tag.conflict) {
      push(tag, ruleOf(tag.attribute as AttrId), 'AI ขัดกับค่าที่ตรวจสอบได้');
      continue;
    }
    // (2) หลักฐานบอกเป็นนัย แต่ AI บอกว่าไม่มี
    if (tag.attribute === 'adjustability' && tag.value_id === 'none') {
      const implied = IMPLIED.find((i) => i.attribute === 'adjustability' && i.test(p, text));
      if (implied) push(tag, [implied.value_id], implied.reason);
      continue;
    }
    // (3) ข้อความบอกว่าไม่มีสิ่งที่ AI อ้าง (เฉพาะค่าที่ "เห็น/อ่านได้")
    const visual = tag.attribute === 'visual_features' || tag.attribute === 'material_visual';
    if (visual && tag.grounded && looksNegated(text, tag.quote)) {
      push(tag, [], 'ข้อความบอกว่าไม่มีลักษณะนี้ แต่ AI ระบุว่ามี');
    }
  }
  return out;
}

export function detectAllConflicts(products: NormalizedProduct[]): ConflictCandidate[] {
  return products.flatMap((p) => detectConflicts(p));
}

/* ── ที่เก็บ ───────────────────────────────────────────────── */

const SELECT_COLUMNS =
  'id,ext,product_id,attribute,value_id,value_label,rule_values,ai_confidence,ai_quote,evidence_type,severity,reason,phrase_key,status,created_at,resolved_at,resolved_by,note';

function toRow(v: any): ConflictRow | null {
  if (!v?.ext || !v?.attribute || !v?.value_id) return null;
  return {
    id: Number(v.id ?? 0),
    ext: String(v.ext),
    product_id: v.product_id == null ? null : Number(v.product_id),
    attribute: String(v.attribute) as AttrId,
    value_id: String(v.value_id),
    value_label: String(v.value_label ?? ''),
    rule_values: Array.isArray(v.rule_values) ? v.rule_values.map(String) : [],
    ai_confidence: Number(v.ai_confidence ?? 0),
    ai_quote: v.ai_quote == null ? null : String(v.ai_quote),
    evidence_type: v.evidence_type === 'image' ? 'image' : 'text',
    severity: v.severity === 'critical' ? 'critical' : 'warning',
    reason: String(v.reason ?? ''),
    phrase_key: v.phrase_key == null ? null : String(v.phrase_key),
    status: (['pending', 'resolved_rule', 'resolved_ai', 'dismissed'].includes(String(v.status))
      ? String(v.status)
      : 'pending') as ConflictStatus,
    created_at: String(v.created_at ?? new Date().toISOString()),
    resolved_at: v.resolved_at == null ? null : String(v.resolved_at),
    resolved_by: v.resolved_by == null ? null : String(v.resolved_by),
    note: v.note == null ? null : String(v.note),
  };
}

async function filePath(): Promise<string> {
  const path = await import('path');
  return path.join(process.cwd(), 'data', 'network', CONFLICT_FILE);
}

/** โหลดความขัดแย้งทั้งหมด (DB → ไฟล์). ไม่ throw */
export async function loadConflicts(
  opts: { status?: ConflictStatus | 'all'; limit?: number } = {},
): Promise<{ rows: ConflictRow[]; store: 'db' | 'file' | 'none' }> {
  let rows: ConflictRow[] = [];
  let store: 'db' | 'file' | 'none' = 'none';
  try {
    const { supabase } = await import('@/lib/supabase');
    let q = supabase
      .from('enrichment_conflicts')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);
    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      rows = data.map(toRow).filter((r): r is ConflictRow => Boolean(r));
      store = 'db';
    }
  } catch {
    /* ไม่มี DB */
  }
  if (store !== 'db') {
    try {
      const fs = await import('fs/promises');
      const raw = await fs.readFile(await filePath(), 'utf8');
      const byKey = new Map<string, ConflictRow>();
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = toRow(JSON.parse(line));
          if (row) byKey.set(conflictKey(row), row);
        } catch {
          /* ข้ามบรรทัดพัง */
        }
      }
      rows = [...byKey.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      store = rows.length ? 'file' : 'none';
    } catch {
      store = 'none';
    }
  }
  if (opts.status && opts.status !== 'all') rows = rows.filter((r) => r.status === opts.status);
  return { rows: rows.slice(0, Math.min(Math.max(opts.limit ?? 100, 1), 500)), store };
}

async function writeConflictRows(rows: ConflictRow[]): Promise<{ persisted: 'db' | 'file' | 'none'; error?: string }> {
  if (!rows.length) return { persisted: 'none' };
  let dbError: string | null = null;
  try {
    const { supabase } = await import('@/lib/supabase');
    const payload = rows.map((r) => ({
      ext: r.ext,
      product_id: r.product_id,
      attribute: r.attribute,
      value_id: r.value_id,
      value_label: r.value_label,
      rule_values: r.rule_values,
      ai_confidence: r.ai_confidence,
      ai_quote: r.ai_quote,
      evidence_type: r.evidence_type,
      severity: r.severity,
      reason: r.reason,
      phrase_key: r.phrase_key,
      status: r.status,
      resolved_at: r.resolved_at,
      resolved_by: r.resolved_by,
      note: r.note,
    }));
    const { error } = await supabase
      .from('enrichment_conflicts')
      .upsert(payload, { onConflict: 'ext,attribute,value_id' });
    if (!error) return { persisted: 'db' };
    // ตารางยังไม่ถูก apply / DB มีปัญหา → ให้ตกไปเขียนไฟล์ด้านล่าง
    throw new Error(error.message);
  } catch (e: any) {
    // เก็บสาเหตุไว้รายงาน (ยังไม่ throw — ไฟล์เป็น fallback ที่ใช้ได้)
    dbError = e?.message || String(e);
  }
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const file = await filePath();
    const existing = await loadConflicts({ status: 'all', limit: 500 });
    const byKey = new Map<string, ConflictRow>();
    for (const row of existing.rows) byKey.set(conflictKey(row), row);
    for (const row of rows) byKey.set(conflictKey(row), row);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${[...byKey.values()].map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
    return { persisted: 'file', ...(dbError ? { error: `DB: ${dbError}` } : {}) };
  } catch (e: any) {
    return { persisted: 'none', error: [dbError, e?.message || String(e)].filter(Boolean).join(' | ') };
  }
}

/* ── enqueue (เรียกได้ทุกครั้งหลัง AI/vision รัน) ──────────── */

export interface EnqueueResult {
  detected: number;
  /** เปิดใหม่จริง (ยังไม่เคยอยู่ในคิว) */
  opened: number;
  /** มีอยู่ในคิวแล้ว — เขียนทับด้วยข้อมูลล่าสุด (ไม่ใช่ของใหม่) */
  refreshed?: number;
  closed: number;
  persisted: 'db' | 'file' | 'none';
  error?: string;
}

export async function enqueueConflicts(products: NormalizedProduct[]): Promise<EnqueueResult> {
  // กันซ้ำในชุดเดียวกัน: 1 (ext, attribute, value_id) ต้องมีแถวเดียว ไม่งั้น upsert ล้ม
  // (ON CONFLICT DO UPDATE cannot affect row a second time) — เก็บ severity สูงสุด, confidence สูงสุด
  const byDetected = new Map<string, ConflictCandidate>();
  for (const c of detectAllConflicts(products)) {
    const key = conflictKey(c);
    const prev = byDetected.get(key);
    if (!prev) byDetected.set(key, c);
    else
      byDetected.set(key, {
        ...prev,
        severity: prev.severity === 'critical' || c.severity === 'critical' ? 'critical' : 'warning',
        ai_confidence: Math.max(prev.ai_confidence, c.ai_confidence),
        rule_values: [...new Set([...prev.rule_values, ...c.rule_values])],
        reason: prev.reason.length >= c.reason.length ? prev.reason : c.reason,
        ai_quote: prev.ai_quote ?? c.ai_quote,
        phrase_key: prev.phrase_key ?? c.phrase_key,
      });
  }
  const detected = [...byDetected.values()];
  const existing = await loadConflicts({ status: 'all', limit: 500 });
  const byKey = new Map(existing.rows.map((r) => [conflictKey(r), r]));
  const stamp = new Date().toISOString();
  const scopedExts = new Set(products.map((p) => p.ext));

  const opened: ConflictRow[] = [];
  let fresh = 0;
  for (const c of detected) {
    const prev = byKey.get(conflictKey(c));
    if (prev && prev.status !== 'pending') continue; // คนตัดสินแล้ว — ห้ามรื้อ
    if (!prev) fresh += 1;
    opened.push({
      ...(prev ?? {
        id: 0,
        status: 'pending' as ConflictStatus,
        created_at: stamp,
        resolved_at: null,
        resolved_by: null,
        note: null,
      }),
      ...c,
      status: 'pending',
    });
  }

  const openedKeys = new Set(opened.map(conflictKey));
  const closed: ConflictRow[] = existing.rows
    .filter((r) => r.status === 'pending' && scopedExts.has(r.ext) && !openedKeys.has(conflictKey(r)))
    .map((r) => ({
      ...r,
      status: 'dismissed' as ConflictStatus,
      resolved_at: stamp,
      resolved_by: 'system',
      note: 'ข้อมูลเปลี่ยน — ไม่พบความขัดแย้งนี้แล้ว',
    }));

  if (!opened.length && !closed.length) {
    return {
      detected: detected.length,
      opened: 0,
      refreshed: 0,
      closed: 0,
      persisted: existing.store === 'none' ? 'none' : existing.store,
    };
  }
  const res = await writeConflictRows([...opened, ...closed]);
  return {
    detected: detected.length,
    opened: fresh,
    refreshed: opened.length - fresh,
    closed: closed.length,
    ...res,
  };
}

/* ── คนตัดสิน ─────────────────────────────────────────────── */

export type ResolveAction = 'accept_rule' | 'accept_ai' | 'dismiss';

export interface ResolveInput {
  ext: string;
  attribute: string;
  value_id: string;
  action: ResolveAction;
  note?: string;
  by?: string;
}

/**
 * บันทึกคำตัดสินของคน
 * - accept_ai → เขียน attribute_overrides (manual ชนะทุกชั้น, pipeline ไม่เขียนทับ)
 * - accept_rule → ยึดหลักฐาน (ไม่เขียน override) + ปฏิเสธวลีถ้ามาจากพจนานุกรม
 */
export async function resolveConflict(
  input: ResolveInput,
): Promise<{ ok: boolean; status?: ConflictStatus; error?: string }> {
  const { rows } = await loadConflicts({ status: 'all', limit: 500 });
  const row = rows.find(
    (r) =>
      r.ext === input.ext && r.attribute === input.attribute && r.value_id === input.value_id,
  );
  if (!row) return { ok: false, error: 'ไม่พบความขัดแย้งนี้' };

  const status: ConflictStatus =
    input.action === 'accept_ai' ? 'resolved_ai' : input.action === 'accept_rule' ? 'resolved_rule' : 'dismissed';

  if (input.action === 'accept_ai') {
    try {
      const { supabase } = await import('@/lib/supabase');
      const { data: current, error: readError } = await supabase
        .from('products')
        .select('id,attribute_overrides')
        .eq('ext', input.ext)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) return { ok: false, error: 'ไม่พบสินค้านี้ในฐานข้อมูล' };
      const overrides = { ...(((current as any).attribute_overrides ?? {}) as Record<string, any>) };
      overrides[input.attribute] = {
        values: [{ value_id: input.value_id, label: valueLabel(row.attribute, input.value_id) }],
        at: new Date().toISOString(),
        by: input.by ?? 'conflict-review',
        ...(input.note ? { note: String(input.note).slice(0, 300) } : {}),
      };
      const { error } = await supabase
        .from('products')
        .update({ attribute_overrides: overrides })
        .eq('id', (current as any).id);
      if (error) throw error;
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  if (row.phrase_key) {
    await adjustPhrase(row.phrase_key, input.action === 'accept_ai' ? 'accept' : 'reject').catch(() => undefined);
  }

  const next: ConflictRow = {
    ...row,
    status,
    resolved_at: new Date().toISOString(),
    resolved_by: input.by ?? 'admin',
    note: input.note ? String(input.note).slice(0, 300) : row.note,
  };
  const res = await writeConflictRows([next]);
  if (res.persisted === 'none') return { ok: false, error: res.error ?? 'บันทึกคำตัดสินไม่สำเร็จ' };
  return { ok: true, status };
}

/** สรุปจำนวนสำหรับ UI/audit */
export async function conflictCounts(): Promise<{ pending: number; critical: number; store: string }> {
  const { rows, store } = await loadConflicts({ status: 'pending', limit: 500 });
  return { pending: rows.length, critical: rows.filter((r) => r.severity === 'critical').length, store };
}
