/**
 * Product Attributes — ชุดมาตรฐานเดียวกันทุกสินค้า
 * ------------------------------------------------
 * ทุกสินค้าได้ 18 attribute ในลำดับคงที่ (ค่าที่ไม่มี = อาร์เรย์ว่าง)
 * ทุกค่ามี source บอกที่มา 3 แบบ:
 *   evidence    = สกัดได้จากข้อความ (ชื่อ/สเปก/ตัวเลือก) ตรวจย้อนได้
 *   computed    = คำนวณจากตัวเลข/กฎ (ขนาด, ช่วงราคา, target context)
 *   ai_inferred = AI อนุมาน (แยกจากหลักฐานเสมอ มี model/confidence/grounded)
 *
 * ไฟล์นี้เป็น "ตัวสร้างเดียว" ที่ UI / API / export / audit ใช้ร่วมกัน
 * เพื่อไม่ให้แต่ละที่มีนิยาม attribute ต่างกัน
 */
import type {
  AttributeCoverage,
  AttributeSource,
  NormalizedProduct,
  ProductAttribute,
  AttributeValue,
} from './types';
import { ATTRIBUTE_MAP, type AttrId } from './vocab';
import { sanitizeAiTags } from './validate-enrichment';

export interface AttributeDef {
  id: string;
  label: string;
  kind: 'base' | 'evidence' | 'ai' | 'computed';
}

/** 18 คีย์มาตรฐาน — ลำดับนี้ใช้ทุกที่ (UI/export/audit) */
export const ATTRIBUTE_DEFS: AttributeDef[] = [
  { id: 'category', label: 'หมวดหมู่', kind: 'base' },
  { id: 'product_type', label: 'ประเภทสินค้า', kind: 'base' },
  { id: 'brand', label: 'แบรนด์', kind: 'base' },
  { id: 'province', label: 'จังหวัด', kind: 'base' },
  { id: 'use_case', label: ATTRIBUTE_MAP.use_case.label, kind: 'evidence' },
  { id: 'function', label: ATTRIBUTE_MAP.function.label, kind: 'evidence' },
  { id: 'context', label: ATTRIBUTE_MAP.context.label, kind: 'evidence' },
  { id: 'style', label: ATTRIBUTE_MAP.style.label, kind: 'evidence' },
  { id: 'space', label: ATTRIBUTE_MAP.space.label, kind: 'evidence' },
  { id: 'audience', label: ATTRIBUTE_MAP.audience.label, kind: 'evidence' },
  { id: 'occasion', label: ATTRIBUTE_MAP.occasion.label, kind: 'ai' },
  { id: 'adjustability', label: ATTRIBUTE_MAP.adjustability.label, kind: 'ai' },
  { id: 'power_source', label: ATTRIBUTE_MAP.power_source.label, kind: 'ai' },
  { id: 'assembly', label: ATTRIBUTE_MAP.assembly.label, kind: 'ai' },
  { id: 'finish', label: ATTRIBUTE_MAP.finish.label, kind: 'ai' },
  { id: 'visual_features', label: ATTRIBUTE_MAP.visual_features.label, kind: 'ai' },
  { id: 'material_visual', label: ATTRIBUTE_MAP.material_visual.label, kind: 'ai' },
  { id: 'size', label: 'ขนาด', kind: 'computed' },
  { id: 'target_context', label: 'บริบทเป้าหมาย', kind: 'computed' },
  { id: 'price_segment', label: 'ช่วงราคา (เทียบตลาด)', kind: 'computed' },
];

export const ATTRIBUTE_IDS = ATTRIBUTE_DEFS.map((d) => d.id);
export const ATTRIBUTE_LABEL: Record<string, string> = Object.fromEntries(
  ATTRIBUTE_DEFS.map((d) => [d.id, d.label]),
);

const evidenceValues = (p: NormalizedProduct, attr: string): AttributeValue[] => {
  const e = p.enrichment;
  const map: Record<string, Array<{ id: string; value: string; confidence: number; evidence: string[] }>> = {
    use_case: e?.use_cases ?? [],
    function: e?.functions ?? [],
    context: e?.contexts ?? [],
    style: e?.styles ?? [],
    space: e?.spaces ?? [],
    audience: e?.audiences ?? [],
  };
  return (map[attr] ?? [])
    .filter((t) => Array.isArray(t.evidence) && t.evidence.length > 0)
    .map((t) => ({
      value_id: t.id,
      label: t.value,
      source: 'evidence' as AttributeSource,
      confidence: t.confidence,
      evidence: t.evidence,
    }));
};

function baseValues(p: NormalizedProduct, attr: string): AttributeValue[] {
  const push = (
    label: string | null | undefined,
    confidence: number,
    evidence: string,
  ): AttributeValue[] =>
    label && label !== '' && label !== 'ไม่ระบุ' && label !== 'other' && evidence
      ? [{ value_id: label, label, source: 'evidence', confidence, evidence: [evidence] }]
      : [];
  switch (attr) {
    case 'category':
      return push(p.category, p.category_confidence, `อนุกรมวิธาน: ${p.category}`);
    case 'product_type':
      return push(p.product_type, p.type_confidence, `อนุกรมวิธาน: ${p.product_type}`);
    case 'brand':
      return push(
        p.brand,
        p.brand_confidence,
        p.brand_evidence ?? `แบรนด์จากข้อมูลสินค้า: ${p.brand}`,
      );
    case 'province':
      return push(
        p.province,
        1,
        p.province_evidence ?? `ที่ตั้งร้าน: ${p.province}`,
      );
    default:
      return [];
  }
}

function computedValues(p: NormalizedProduct, attr: string): AttributeValue[] {
  if (attr === 'size') {
    if (!p.size_label) return [];
    return [
      {
        value_id: p.size_label,
        label: p.size_label,
        source: 'computed',
        confidence: p.size_confidence ?? 1,
        evidence: [
          `ขนาด ${[p.width_cm, p.depth_cm, p.height_cm]
            .map((v) => (v == null ? '—' : String(v)))
            .join('×')} ซม.${p.size_source ? ` (จาก ${p.size_source})` : ''}`,
        ],
      },
    ];
  }
  if (attr === 'target_context') {
    return (p.enrichment?.target_contexts ?? []).map((t) => ({
      value_id: t.id,
      label: t.value,
      source: 'computed' as AttributeSource,
      confidence: t.confidence,
      evidence: t.evidence,
    }));
  }
  if (attr === 'price_segment') {
    const seg = p.enrichment?.price_segment;
    if (!seg || seg.label === 'Unknown') return [];
    return [
      {
        value_id: seg.label,
        label: seg.label,
        source: 'computed',
        confidence: 1,
        evidence: [
          `basis=${seg.basis}${seg.median != null ? ` · median ฿${seg.median}` : ''}${
            seg.sample ? ` · sample ${seg.sample}` : ''
          }${seg.percentile != null ? ` · percentile ${seg.percentile}` : ''}`,
        ],
      },
    ];
  }
  return [];
}

function aiValues(p: NormalizedProduct, attr: string): AttributeValue[] {
  return sanitizeAiTags(p.ai?.tags ?? [], p)
    .filter((t) => t.attribute === attr)
    .map((t) => {
      const evidence = t.quote ? [t.quote] : t.region ? [t.region] : undefined;
      return {
        value_id: t.value_id,
        label: t.value,
        source: 'ai_inferred' as AttributeSource,
        confidence: t.confidence,
        ...(evidence ? { evidence } : {}),
        grounded: t.grounded,
        conflict: t.conflict ?? false,
        evidence_type: t.evidence_type ?? 'text',
        ai_model: p.ai?.meta?.model,
      };
    });
}

/** เก็บค่า (value_id) เดียวกันครั้งเดียว — evidence ชนะ ai/computed, ที่เหลือเก็บ confidence สูงสุด */
function dedupeValues(values: AttributeValue[]): AttributeValue[] {
  const out = new Map<string, AttributeValue>();
  for (const v of values) {
    const prev = out.get(v.value_id);
    if (!prev) {
      out.set(v.value_id, v);
      continue;
    }
    const prevEvidence = prev.source === 'evidence';
    const nextEvidence = v.source === 'evidence';
    if (nextEvidence && !prevEvidence) {
      out.set(v.value_id, v);
      continue;
    }
    if (prevEvidence && !nextEvidence) continue;
    if (v.confidence > prev.confidence) out.set(v.value_id, v);
    else if (v.evidence?.length && !prev.evidence?.length) {
      out.set(v.value_id, { ...prev, evidence: v.evidence });
    }
  }
  return [...out.values()];
}

/** ค่าที่ admin แก้เอง — ชนะทุกแหล่งของ attribute เดียวกัน */
function manualValues(p: NormalizedProduct, attr: string): AttributeValue[] | null {
  const ov = p.overrides?.[attr];
  if (!ov || !ov.values.length) return null;
  return ov.values.map((v) => ({
    value_id: v.value_id,
    label: v.label || v.value_id,
    source: 'manual' as AttributeSource,
    confidence: 1,
    ...(ov.note ? { evidence: [ov.note] } : {}),
  }));
}

function statusOf(values: AttributeValue[]): ProductAttribute['status'] {
  if (values.length === 0) return 'none';
  if (values.some((v) => v.source === 'manual')) return 'manual';
  const hasEvidence = values.some((v) => v.source === 'evidence');
  const hasAi = values.some((v) => v.source === 'ai_inferred');
  const hasComputed = values.some((v) => v.source === 'computed');
  if (hasEvidence && hasAi) return 'mixed';
  if (hasEvidence) return 'evidence';
  if (hasAi) return 'ai';
  if (hasComputed) return 'computed';
  return 'none';
}

/** ชุด attribute มาตรฐาน 18 รายการ (ลำดับคงที่) ของสินค้า 1 ชิ้น */
export function buildProductAttributes(p: NormalizedProduct): ProductAttribute[] {
  return ATTRIBUTE_DEFS.map((def) => {
    const auto =
      def.kind === 'base'
        ? baseValues(p, def.id)
        : def.kind === 'computed'
          ? computedValues(p, def.id)
          : dedupeValues([...evidenceValues(p, def.id), ...aiValues(p, def.id)]);

    const manual = manualValues(p, def.id);
    if (manual) {
      return {
        attribute: def.id,
        label: def.label,
        values: manual,
        status: 'manual' as const,
        overridden: true,
        superseded: auto.length,
      };
    }
    return { attribute: def.id, label: def.label, values: auto, status: statusOf(auto) };
  });
}

/** สรุปความครอบคลุมต่อ attribute (หลักฐาน vs AI vs คำนวณ vs คนแก้) */
export function attributeCoverage(products: NormalizedProduct[]): AttributeCoverage[] {
  const total = products.length;
  return ATTRIBUTE_DEFS.map((def) => {
    let evidence = 0;
    let ai = 0;
    let computed = 0;
    let manual = 0;
    let present = 0;
    for (const p of products) {
      const values = buildProductAttributes(p).find((a) => a.attribute === def.id)?.values ?? [];
      if (!values.length) continue;
      present += 1;
      if (values.some((v) => v.source === 'evidence')) evidence += 1;
      if (values.some((v) => v.source === 'ai_inferred')) ai += 1;
      if (values.some((v) => v.source === 'computed')) computed += 1;
      if (values.some((v) => v.source === 'manual')) manual += 1;
    }
    return {
      attribute: def.id,
      label: def.label,
      total,
      evidence,
      ai,
      computed,
      manual,
      none: total - present,
    };
  });
}

/** ค่าทั้งหมดของสินค้าในรูปแบบ long (ใช้ทำ export/CSV) */
export function flattenAttributes(
  p: NormalizedProduct,
  opts: { includeEmpty?: boolean } = {},
): Array<{
  attribute: string;
  attribute_label: string;
  value_id: string;
  value_label: string;
  source: AttributeSource | 'none';
  confidence: number;
  evidence: string;
  grounded: string;
  conflict: string;
  ai_model: string;
  /** ที่มาของหลักฐานของค่าจาก AI: quote (ข้อความ) หรือ region (ภาพ) */
  evidence_type: string;
  visual: string;
  overridden: string;
}> {
  const out: ReturnType<typeof flattenAttributes> = [];
  for (const attr of buildProductAttributes(p)) {
    if (attr.values.length === 0) {
      if (!opts.includeEmpty) continue;
      out.push({
        attribute: attr.attribute,
        attribute_label: attr.label,
        value_id: '',
        value_label: '',
        source: 'none',
        confidence: 0,
        evidence: '',
        grounded: '',
        conflict: '',
        ai_model: '',
        evidence_type: '',
        visual: '',
        overridden: '',
      });
      continue;
    }
    for (const v of attr.values) {
      const tag = (p.ai?.tags ?? []).find(
        (t) => t.attribute === attr.attribute && t.value_id === v.value_id,
      );
      out.push({
        attribute: attr.attribute,
        attribute_label: attr.label,
        value_id: v.value_id,
        value_label: v.label,
        source: v.source,
        confidence: v.confidence,
        evidence: (v.evidence ?? []).join(' · '),
        grounded: v.grounded == null ? '' : v.grounded ? 'quote' : 'inferred',
        conflict: v.conflict ? 'yes' : '',
        ai_model: v.ai_model ?? '',
        evidence_type: v.evidence_type ?? '',
        visual: tag?.region ?? (tag?.bbox ? `${tag.bbox.x},${tag.bbox.y},${tag.bbox.w},${tag.bbox.h}` : ''),
        overridden: attr.overridden ? 'yes' : '',
      });
    }
  }
  return out;
}

/** ใช้ตรวจ invariant: attribute id ต้องอยู่ในรายการมาตรฐานเท่านั้น */
export function isStandardAttribute(id: string): boolean {
  return ATTRIBUTE_IDS.includes(id);
}

export type { AttrId };
