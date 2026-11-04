/**
 * กฎการสร้าง edge ระดับ graph (deterministic ล้วน — ไม่มี LLM)
 * ------------------------------------------------
 * แยกตัวเลข/เกณฑ์ทั้งหมดไว้ที่เดียว เพื่อให้ graph, gate และ opportunity
 * ใช้ความหมายเดียวกัน และตรวจสอบย้อนกลับได้ว่าทำไม edge ถึงเกิด
 */
import type { EnrichedTag, NormalizedProduct } from './types';

/** กลุ่ม attribute ที่ใช้เป็น "หลักฐานเชิงความหมาย" ของสินค้า */
export const SEMANTIC_GROUPS = [
  { key: 'use_cases', prefix: 'use', label: 'use case' },
  { key: 'contexts', prefix: 'ctx', label: 'บริบท' },
  { key: 'functions', prefix: 'fn', label: 'ฟังก์ชัน' },
  { key: 'spaces', prefix: 'space', label: 'พื้นที่' },
  { key: 'styles', prefix: 'style', label: 'สไตล์' },
  { key: 'audiences', prefix: 'aud', label: 'กลุ่มผู้ใช้' },
] as const;

/** context/use case/space ถือเป็น "บริบท" ที่ใช้ proj​ect ความสัมพันธ์ cross-type */
export const CONTEXTUAL_PREFIXES = ['use', 'ctx', 'space'] as const;

/**
 * เกณฑ์เริ่มต้น (ปรับได้ผ่าน PipelineConfig)
 * หมายเหตุ: rule tag ที่พบในชื่อมี confidence 0.6 · ในสเปก 0.5 · หลายแหล่งรวมกัน ~0.74–0.82
 * ถ้าตั้ง 0.7 ตามเอกสารตรง ๆ ข้อมูลชุดปัจจุบัน (61 สินค้า) จะเหลือ context เพียง 4 รายการ
 * จึงใช้ 0.6 เป็นค่าเริ่มต้น และมี preset "เข้ม" ที่ 0.75 สำหรับข้อมูลที่หนาพอ
 */
export const GRAPH_RULES = {
  edge_min_confidence: 0.6,
  edge_strong_min_confidence: 0.7,
  ai_edge_min_confidence: 0.7,
  /**
   * ค่าเริ่มต้น 0.5 (ไม่ใช่ 0.7): tag เฉลี่ยต่อสินค้าในข้อมูลจริงมีเพียง ~1.5 ค่า
   * ทำให้ Jaccard 0.7 ตัดคู่ที่ควรจับเกือบทั้งหมด — preset "เข้ม" ตั้ง 0.8 ได้
   */
  attribute_overlap_min: 0.5,
  substitute_price_compat: 0.8,
  /** คู่ที่ไม่มี context/use case ร่วม ถ่วงน้ำหนักลงเท่านี้ (แต่ยังมี shared category) */
  evidence_gap_penalty: 0.85,
} as const;

/**
 * วลีที่บ่งชี้ว่า "ใช้ด้วยกัน" (ต้องมีหลักฐานในข้อความจริงเท่านั้น)
 * ตั้งใจไม่รวม "พร้อม"/"แถม"/"เซ็ต" เดี่ยว ๆ เพราะบน Shopee มักแปลว่า
 * "พร้อมส่ง" / "แถมฟรี" ซึ่งไม่ใช่หลักฐานการใช้ร่วมกัน → จะสร้าง edge ขยะ
 */
export const BUNDLE_PATTERNS =
  /(?:ซื้อคู่|ใช้คู่กับ|คู่กับ|พร้อมกัน|จัดชุด|เป็นเซ็ต|เซ็ตคู่|ชุดคู่|ขายพร้อม)/i;

export interface SemanticTag {
  /** `${prefix}:${id}` — ใช้เป็น key ของ set */
  key: string;
  prefix: string;
  id: string;
  label: string;
  confidence: number;
  source: 'evidence' | 'ai_grounded';
}

function enrichmentTags(p: NormalizedProduct, key: string): EnrichedTag[] {
  const list = (p.enrichment as unknown as Record<string, EnrichedTag[]>)?.[key];
  return Array.isArray(list) ? list : [];
}

/**
 * รวมแท็กเชิงความหมายของสินค้า 1 ชิ้น
 * - หลักฐานจาก rule: ต้อง conf ≥ minConfidence
 * - AI: ต้อง grounded=true, ไม่ conflict, conf ≥ aiMin
 */
export function semanticTags(
  p: NormalizedProduct,
  minConfidence: number = GRAPH_RULES.edge_min_confidence,
  aiMin: number = GRAPH_RULES.ai_edge_min_confidence,
): SemanticTag[] {
  const out = new Map<string, SemanticTag>();
  for (const group of SEMANTIC_GROUPS) {
    for (const tag of enrichmentTags(p, group.key)) {
      if (!tag || typeof tag.confidence !== 'number') continue;
      if (tag.confidence < minConfidence) continue;
      const key = `${group.prefix}:${tag.id}`;
      const prev = out.get(key);
      if (!prev || prev.confidence < tag.confidence) {
        out.set(key, {
          key,
          prefix: group.prefix,
          id: tag.id,
          label: tag.value || tag.id,
          confidence: tag.confidence,
          source: 'evidence',
        });
      }
    }
  }
  for (const tag of p.ai?.tags ?? []) {
    if (tag.grounded !== true || tag.conflict === true) continue;
    if (tag.confidence < aiMin) continue;
    const group = SEMANTIC_GROUPS.find((g) => g.key === `${tag.attribute}s`);
    if (!group) continue;
    const key = `${group.prefix}:${tag.value_id}`;
    if (out.has(key)) continue; // หลักฐาน rule ชนะ AI
    out.set(key, {
      key,
      prefix: group.prefix,
      id: tag.value_id,
      label: tag.value || tag.value_id,
      confidence: tag.confidence,
      source: 'ai_grounded',
    });
  }
  return [...out.values()];
}

export function semanticKeySet(tags: SemanticTag[]): Set<string> {
  return new Set(tags.map((t) => t.key));
}

export function contextualKeys(tags: SemanticTag[]): Set<string> {
  return new Set(
    tags
      .filter((t) => (CONTEXTUAL_PREFIXES as readonly string[]).includes(t.prefix))
      .map((t) => t.key),
  );
}

/** Jaccard ของ set — คืน 0 เมื่อ union ว่าง */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  const out: T[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

/** ค่าเฉลี่ย confidence ของ tag ที่มี key ตรงกัน (ใช้ถ่วงน้ำหนัก edge) */
export function meanConfidence(tags: SemanticTag[], keys: Iterable<string>): number {
  const byKey = new Map(tags.map((t) => [t.key, t.confidence]));
  const values: number[] = [];
  for (const k of keys) {
    const c = byKey.get(k);
    if (typeof c === 'number') values.push(c);
  }
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Trust factor ของคู่สินค้า — ฝั่งที่อ่อนกว่าคุมน้ำหนัก
 * (quality_score เป็น proxy ของ trust ที่ตรวจย้อนได้; ไม่มีค่า = 0)
 */
export function trustFactor(a: NormalizedProduct, b: NormalizedProduct): number {
  const qa = Number(a.quality_score ?? a.trust_score ?? 0);
  const qb = Number(b.quality_score ?? b.trust_score ?? 0);
  const weak = Math.max(0, Math.min(100, Math.min(qa, qb)));
  return 0.6 + 0.4 * (weak / 100);
}

/** ข้อความที่ใช้หาหลักฐาน "ใช้ด้วยกัน" (ชื่อ + คำอธิบาย) */
export function bundleEvidenceText(p: NormalizedProduct): string {
  return `${p.name} ${p.description ?? ''}`.trim();
}

export function roundWeight(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
}
