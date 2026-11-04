/**
 * Layer 3 — Validation & Merging
 * -------------------------------
 * ทำความสะอาดผลจาก rule/AI/วลี ก่อนเก็บเป็น ProductEnrichment / AiEnrichment
 *
 * กติกา:
 *  - source=evidence ต้องมี evidence จริง (ตรวจย้อนได้)
 *  - ค่าที่ซ้ำกันเก็บตัวที่หลักฐานดีกว่า/confidence สูงกว่า
 *  - hierarchy: audience student ตัด use_case study; audience kids/baby ตัด baby_care
 *    เฉพาะเมื่อหลักฐานเป็นคำเด็กเดี่ยว (ไม่ใช่ "ดูแลเด็ก")
 *  - AI text ห้ามสร้าง visual_features/material_visual (vision-only)
 *  - style จาก SEO term / การอนุมานลอย ๆ ถูกตัด
 */
import type { AiTag, EnrichedTag, NormalizedProduct } from './types';
import { ATTRIBUTE_MAP, isValidValue, VISUAL_ATTR_IDS, type AttrId } from './vocab';
import { containsSeoTerm, SEO_DERIVED_STYLE_VALUES } from './seo-keywords';

const EVIDENCE_LISTS = ['use_cases', 'functions', 'contexts', 'styles', 'spaces', 'audiences', 'target_contexts'] as const;

export function productText(p: NormalizedProduct): string {
  return [
    p.name,
    ...(p.specs ?? []).map((s) => `${s.name} ${s.value}`),
    ...(p.variants ?? []).map((v) => String(v.name ?? v.model_id ?? '')),
    p.description ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

const hasChildWord = (text: string): boolean =>
  /(?:เด็ก|baby|kids?)/i.test(text) && !/(?:ดูแลเด็ก|ทารก|แรกเกิด|baby care)/i.test(text);

/**
 * ตรวจ AI tag หนึ่งรายการ — คืน null = ทิ้ง
 * `text` = ข้อความสินค้า (normalized แล้ว) ใช้ตรวจ quote
 */
export function sanitizeAiTag(tag: AiTag, text: string): AiTag | null {
  const attribute = tag.attribute as AttrId;
  if (!ATTRIBUTE_MAP[attribute]) return null;
  if (!isValidValue(attribute, tag.value_id)) return null;

  const isImage = tag.evidence_type === 'image' || tag.origin === 'vision';
  // ค่าที่เห็นจากภาพต้องมาจากภาพเท่านั้น
  if (VISUAL_ATTR_IDS.includes(attribute) && !isImage) return null;

  const quote = String(tag.quote ?? '');
  // ใช้ quote เป็นหลักถ้ามี — ข้อความอื่นในสินค้าไม่ควรเปลี่ยนความหมายของ tag นี้
  const evidenceText = (quote || text).toLowerCase();

  // style ที่มาจาก SEO/marketing — โดยเฉพาะเมื่อ quote เป็นคำโฆษณา
  if (
    attribute === 'style' &&
    (SEO_DERIVED_STYLE_VALUES as readonly string[]).includes(tag.value_id) &&
    (!quote || containsSeoTerm(quote))
  ) {
    return null;
  }

  // "เด็ก" ต้องเป็น audience ไม่ใช่ use_case baby_care (ยกเว้น "ดูแลเด็ก")
  if (attribute === 'use_case' && tag.value_id === 'baby_care' && hasChildWord(evidenceText)) {
    return null;
  }

  // "เขียนหนังสือ" เป็น writing ไม่ใช่ reading
  if (
    attribute === 'use_case' &&
    tag.value_id === 'reading' &&
    /เขียนหนังสือ/.test(evidenceText) &&
    !/อ่าน/.test(evidenceText)
  ) {
    return null;
  }

  return tag;
}

export function sanitizeAiTags(tags: AiTag[], p: NormalizedProduct): AiTag[] {
  const text = productText(p);
  return tags
    .map((tag) => sanitizeAiTag(tag, text))
    .filter((tag): tag is AiTag => tag != null);
}

/** รวมแท็กซ้ำ (id เดียวกัน) โดยเก็บ evidence และ confidence ที่ดีกว่า */
function dedupeEnriched(list: EnrichedTag[]): EnrichedTag[] {
  const out = new Map<string, EnrichedTag>();
  for (const tag of list) {
    const prev = out.get(tag.id);
    if (!prev) {
      out.set(tag.id, { ...tag, evidence: [...(tag.evidence ?? [])] });
      continue;
    }
    out.set(tag.id, {
      ...prev,
      confidence: Math.max(prev.confidence, tag.confidence),
      evidence: [...new Set([...(prev.evidence ?? []), ...(tag.evidence ?? [])])].slice(0, 3),
    });
  }
  return [...out.values()];
}

/** ค่า evidence ต้องไม่ว่าง — ใช้กับ rule/หลักฐานเท่านั้น (AI มี quote/region แยก) */
function cleanEvidenceTags(list: EnrichedTag[]): EnrichedTag[] {
  return dedupeEnriched(list).filter((t) => Array.isArray(t.evidence) && t.evidence.length > 0);
}

function bareChildEvidence(tag: EnrichedTag): boolean {
  const text = (tag.evidence ?? []).join(' ').toLowerCase();
  return hasChildWord(text);
}

/**
 * ตรวจ/ปรับสินค้า 1 ชิ้น (mutate) — คืน true เมื่อมีการเปลี่ยน
 */
export function validateEnrichmentOne(p: NormalizedProduct): boolean {
  const before = JSON.stringify({
    e: p.enrichment,
    a: p.ai?.tags ?? null,
  });

  const e: any = p.enrichment;
  // รองรับแถวเก่าที่ไม่มี audiences
  if (!Array.isArray(e.audiences)) e.audiences = [];

  // 1) dedupe + require evidence
  for (const key of EVIDENCE_LISTS) {
    if (!Array.isArray(e[key])) continue;
    e[key] = cleanEvidenceTags(e[key]);
  }

  // 2) AI tags: sanitize + dedupe (attribute,value_id)
  if (p.ai?.tags?.length) {
    const seen = new Set<string>();
    p.ai.tags = sanitizeAiTags(p.ai.tags, p).filter((tag) => {
      const key = `${tag.attribute}|${tag.value_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 3) hierarchy
  const audienceIds = new Set<string>([
    ...(e.audiences ?? []).map((t: EnrichedTag) => t.id),
    ...(p.ai?.tags ?? []).filter((t) => t.attribute === 'audience').map((t) => t.value_id),
  ]);
  const dropUse = new Set<string>();
  if (audienceIds.has('student')) dropUse.add('study');
  if (audienceIds.has('kids') || audienceIds.has('baby')) {
    const hasBareChild = (e.use_cases ?? []).some(
      (t: EnrichedTag) => t.id === 'baby_care' && bareChildEvidence(t),
    ) || (p.ai?.tags ?? []).some(
      (t) => t.attribute === 'use_case' && t.value_id === 'baby_care' && hasChildWord(String(t.quote ?? '')),
    );
    if (hasBareChild) dropUse.add('baby_care');
  }
  if (dropUse.size) {
    e.use_cases = (e.use_cases ?? []).filter((t: EnrichedTag) => !dropUse.has(t.id));
    if (p.ai?.tags?.length) {
      p.ai.tags = p.ai.tags.filter(
        (t) => !(t.attribute === 'use_case' && dropUse.has(t.value_id)),
      );
    }
    e.target_contexts = (e.target_contexts ?? []).filter(
      (t: EnrichedTag) => ![...dropUse].some((id) => t.id === `use_${id}`),
    );
  }

  // 4) space small_space ซ้ำกับ target_context small_space_only → เก็บหลักฐานจริงไว้
  const hasSmallSpace = (e.spaces ?? []).some((t: EnrichedTag) => t.id === 'small_space');
  if (hasSmallSpace && Array.isArray(e.target_contexts)) {
    e.target_contexts = e.target_contexts.filter(
      (t: EnrichedTag) => t.id !== 'small_space_only',
    );
  }

  return before !== JSON.stringify({ e: p.enrichment, a: p.ai?.tags ?? null });
}

/** ตรวจทั้งชุด — คืน key ของแถวที่เปลี่ยน (ใช้เติม updatedKeys) */
export function validateEnrichment(products: NormalizedProduct[]): {
  changed: Set<string>;
  changedCount: number;
} {
  const changed = new Set<string>();
  for (const p of products) {
    try {
      if (validateEnrichmentOne(p)) changed.add(p.node_key);
    } catch {
      /* แถวพังต้องไม่ทำให้ทั้งงานล้ม */
    }
  }
  return { changed, changedCount: changed.size };
}
