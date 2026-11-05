/**
 * Product Attributes — ชุดมาตรฐานเดียวกันทุกสินค้า
 * ------------------------------------------------
 * CHANGELOG v3 (2026-11-05):
 *  - ✅ เพิ่ม AttributeResolution (6 สถานะ) ให้ Admin รู้ว่าต้องทำอะไรต่อ
 *  - ✅ แยก AI Failed / Validation Rejected / Needs Vision / Needs Data
 *  - ✅ เก็บเหตุผล (reason) ที่อ่านรู้เรื่องทุก attribute
 *  - คง status เดิมไว้ (backward-compatible)
 */

import type {
  AttributeCoverage,
  AttributeResolution,
  AttributeSource,
  NormalizedProduct,
  ProductAttribute,
  AttributeValue,
  ResolutionStatus,
} from './types';
import { ATTRIBUTE_MAP, VISUAL_ATTR_IDS, type AttrId } from './vocab';
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

/* ── ค่าจากแต่ละแหล่ง (เหมือนเดิม) ─────────────────────── */

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
      return push(p.brand, p.brand_confidence, p.brand_evidence ?? `แบรนด์จากข้อมูลสินค้า: ${p.brand}`);
    case 'province':
      return push(p.province, 1, p.province_evidence ?? `ที่ตั้งร้าน: ${p.province}`);
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

/* ── Resolution Logic (ใหม่) ───────────────────────────── */

/**
 * ตัดสิน Resolution Status ของ attribute 1 ตัว
 * - ใช้ status ของ values + ประเภท attribute + meta ของ AI
 * - คืน reason ที่อ่านรู้เรื่องทุกครั้ง
 */
function resolveAttribute(
  p: NormalizedProduct,
  def: AttributeDef,
  values: AttributeValue[],
): AttributeResolution {
  // 1) มีค่าจริงแล้ว → verified หรือ ai_inferred
  if (values.length > 0) {
    const hasManual = values.some((v) => v.source === 'manual');
    if (hasManual) {
      return { status: 'verified', reason: 'Admin แก้ไขเอง (override)' };
    }
    const hasEvidence = values.some((v) => v.source === 'evidence');
    const hasComputed = values.some((v) => v.source === 'computed');
    if (hasEvidence || hasComputed) {
      const src = hasEvidence ? 'หลักฐานจากข้อความ' : 'คำนวณจากข้อมูลจริง';
      const ev = values.flatMap((v) => v.evidence ?? []).slice(0, 1)[0];
      return {
        status: 'verified',
        reason: ev ? `${src}: "${ev.slice(0, 60)}"` : src,
      };
    }
    // all ai_inferred
    const aiTag = p.ai?.tags?.find(
      (t) => t.attribute === def.id && t.value_id === values[0].value_id,
    );
    const model = p.ai?.meta?.model ?? 'AI';
    if (aiTag?.grounded) {
      return {
        status: 'ai_inferred',
        reason: `AI อ้างคำจริง: "${(aiTag.quote ?? '').slice(0, 60)}" (${model})`,
        ai_model: model,
      };
    }
    return {
      status: 'ai_inferred',
      reason: `AI อนุมาน (ไม่มี quote ตรง, confidence ${(values[0].confidence * 100).toFixed(0)}%) — ${model}`,
      ai_model: model,
    };
  }

  // 2) ไม่มีค่า → แยกตามประเภท attribute

  const aiMeta = p.ai?.meta;
  const aiStatus = aiMeta?.status;
  const validation = aiMeta?.validation;

  // 2.1) Visual attribute → ต้องใช้ Vision
  const isVisual = def.id === 'visual_features' || def.id === 'material_visual';
  if (isVisual) {
    // ถ้าอ่านภาพแล้วแต่ไม่พบ → needs_data (จบแล้ว)
    if (aiMeta?.vision) {
      return {
        status: 'needs_data',
        reason: `อ่านภาพแล้ว (${aiMeta.vision.images} รูป) แต่ไม่พบ${def.label}`,
      };
    }
    // ไม่มีรูปให้อ่าน
    if (!p.image && !(p.images?.length)) {
      return {
        status: 'needs_data',
        reason: 'สินค้าไม่มีรูปให้อ่าน',
      };
    }
    return {
      status: 'needs_vision',
      reason: 'ต้องใช้ Vision AI อ่านภาพ (ยังไม่ได้อ่าน)',
      vision_pending_url: p.image ?? p.images?.[0],
    };
  }

  // 2.2) AI-only attribute (evidence_capable = false)
  const vocabDef = ATTRIBUTE_MAP[def.id as AttrId];
  const isAiOnly = vocabDef && !vocabDef.evidence_capable;

  if (isAiOnly) {
    if (!p.ai) {
      return {
        status: 'ai_failed',
        reason: 'ยังไม่ถูกเรียก AI (สินค้านี้ไม่มี ai_enrichment)',
      };
    }
    if (aiStatus === 'error') {
      return {
        status: 'ai_failed',
        reason: 'เรียก AI ไม่สำเร็จ',
        error: aiMeta?.error ?? 'unknown error',
      };
    }
    if (aiStatus === 'disabled') {
      return {
        status: 'needs_data',
        reason: 'ถูกข้ามเพราะกฎให้ข้อมูลหลักครบแล้ว (เปิด ai_focus_ai_only เพื่อเก็บค่า)',
      };
    }
    // AI ok แต่ถูก validation reject
    const rejected = validation?.rejected_by_attr?.[def.id] ?? 0;
    if (rejected > 0) {
      return {
        status: 'validation_rejected',
        reason: `AI ตอบ ${rejected} ค่า แต่ระบบไม่ยอมรับ (confidence ต่ำ / quote ไม่ตรง / vocab ไม่มี)`,
        rejected_count: rejected,
      };
    }
    // AI ok แต่ไม่ตอบ attribute นี้
    return {
      status: 'needs_data',
      reason: 'AI พิจารณาแล้วไม่พบข้อมูลที่เพียงพอ',
    };
  }

  // 2.3) Evidence-capable (rule ควรจับได้ แต่ไม่จับ)
  // ตรวจข้อความสั้นเกินไป
  const textLen =
    (p.name?.length ?? 0) +
    (p.description?.length ?? 0) +
    (p.specs?.length ?? 0) * 15;
  if (textLen < 50) {
    return {
      status: 'needs_data',
      reason: 'ข้อความต้นทางสั้นเกินไป (ต้องมีชื่อ+สเปกหรือ description)',
    };
  }

  // rule ไม่จับ → AI ควรถูกเรียก
  if (!p.ai) {
    return {
      status: 'ai_failed',
      reason: 'rule ไม่จับ และยังไม่ถูกเรียก AI',
    };
  }
  if (aiStatus === 'error') {
    return {
      status: 'ai_failed',
      reason: 'rule ไม่จับ + เรียก AI ไม่สำเร็จ',
      error: aiMeta?.error ?? 'unknown error',
    };
  }
  const rejected = validation?.rejected_by_attr?.[def.id] ?? 0;
  if (rejected > 0) {
    return {
      status: 'validation_rejected',
      reason: `rule ไม่จับ + AI ตอบ ${rejected} ค่า แต่ถูกตัด`,
      rejected_count: rejected,
    };
  }
  return {
    status: 'needs_data',
    reason: 'rule ไม่จับ + AI พิจารณาแล้วไม่พบข้อมูล',
  };
}

/* ── Public API ────────────────────────────────────────── */

/** ชุด attribute มาตรฐาน 18 รายการ พร้อม resolution */
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
        resolution: { status: 'verified' as const, reason: 'Admin แก้ไขเอง (override)' },
        overridden: true,
        superseded: auto.length,
      };
    }
    return {
      attribute: def.id,
      label: def.label,
      values: auto,
      status: statusOf(auto),
      resolution: resolveAttribute(p, def, auto),
    };
  });
}

/** สรุปจำนวน attribute แยกตาม Resolution Status (สำหรับ Dashboard) */
export function resolutionSummary(products: NormalizedProduct[]): Record<ResolutionStatus, number> {
  const out: Record<ResolutionStatus, number> = {
    verified: 0,
    ai_inferred: 0,
    needs_vision: 0,
    needs_data: 0,
    ai_failed: 0,
    validation_rejected: 0,
  };
  for (const p of products) {
    for (const attr of buildProductAttributes(p)) {
      out[attr.resolution.status] += 1;
    }
  }
  return out;
}

/** สรุปต่อ attribute (จำนวนสินค้าที่ตกในแต่ละ Resolution Status) */
export function resolutionByAttribute(
  products: NormalizedProduct[],
): Array<{ attribute: string; label: string; counts: Record<ResolutionStatus, number>; total: number }> {
  return ATTRIBUTE_DEFS.map((def) => {
    const counts: Record<ResolutionStatus, number> = {
      verified: 0,
      ai_inferred: 0,
      needs_vision: 0,
      needs_data: 0,
      ai_failed: 0,
      validation_rejected: 0,
    };
    for (const p of products) {
      const attr = buildProductAttributes(p).find((a) => a.attribute === def.id);
      if (attr) counts[attr.resolution.status] += 1;
    }
    return { attribute: def.id, label: def.label, counts, total: products.length };
  });
}

/** รายการงานที่ Admin ต้องทำ (เฉพาะ status ที่ต้องการคน) */
export interface AdminActionItem {
  product_key: string;
  product_name: string;
  attribute: string;
  attribute_label: string;
  status: ResolutionStatus;
  reason: string;
  /** ถ้า needs_vision → URL รูป */
  vision_url?: string;
  /** ถ้า ai_failed → error */
  error?: string;
}

export function listAdminActions(
  products: NormalizedProduct[],
  filter?: ResolutionStatus[],
): AdminActionItem[] {
  const target = filter ?? ['needs_vision', 'needs_data', 'ai_failed', 'validation_rejected'];
  const out: AdminActionItem[] = [];
  for (const p of products) {
    for (const attr of buildProductAttributes(p)) {
      if (!target.includes(attr.resolution.status)) continue;
      out.push({
        product_key: p.node_key,
        product_name: p.name,
        attribute: attr.attribute,
        attribute_label: attr.label,
        status: attr.resolution.status,
        reason: attr.resolution.reason,
        vision_url: attr.resolution.vision_pending_url,
        error: attr.resolution.error,
      });
    }
  }
  return out;
}

/** Coverage (เหมือนเดิม) */
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

/** Flatten (เหมือนเดิม + เพิ่ม resolution) */
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
  evidence_type: string;
  visual: string;
  overridden: string;
  /** ── ใหม่ ── */
  resolution_status: ResolutionStatus;
  resolution_reason: string;
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
        resolution_status: attr.resolution.status,
        resolution_reason: attr.resolution.reason,
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
        resolution_status: attr.resolution.status,
        resolution_reason: attr.resolution.reason,
      });
    }
  }
  return out;
}

export function isStandardAttribute(id: string): boolean {
  return ATTRIBUTE_IDS.includes(id);
}

export type { AttrId };