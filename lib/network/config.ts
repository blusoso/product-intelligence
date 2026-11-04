import type { PipelineConfig } from './types';

/**
 * ค่าที่ผู้ใช้ปรับได้จากหน้า Network
 * - clamp ฝั่ง server เสมอ ไม่เชื่อค่าจาก client
 * - preset ประกอบจาก DEFAULT_CONFIG เพื่อไม่ให้ตัวเลขสองที่เพี้ยนกัน
 */

export const CONFIG_LIMITS = {
  similarity_threshold: { min: 0.1, max: 0.95, step: 0.01 },
  max_neighbors: { min: 1, max: 30, step: 1 },
  max_pair_candidates: { min: 10, max: 2000, step: 10 },
  edge_min_confidence: { min: 0.4, max: 0.9, step: 0.05 },
  attribute_overlap_min: { min: 0.3, max: 0.9, step: 0.05 },
  gate_max_age_days: { min: 1, max: 90, step: 1 },
  canonical_threshold: { min: 0.5, max: 1, step: 0.01 },
  enrich_min_confidence: { min: 0.3, max: 0.9, step: 0.05 },
  ai_min_confidence: { min: 0.3, max: 0.95, step: 0.05 },
  ai_max_records_per_run: { min: 10, max: 1000, step: 10 },
  /** 0 = ไม่ gate · 2 = ข้ามแถวที่มีทั้ง use case และบริบทจากหลักฐาน (ค่าเริ่มต้น) */
  ai_gate_min_text_fields: { min: 0, max: 2, step: 1 },
  vision_max_records_per_run: { min: 1, max: 200, step: 1 },
} as const;

const DEDUPE_MODES: PipelineConfig['dedupe'][] = ['merge', 'keep-first', 'keep-richest'];
const CANONICAL_MODES: PipelineConfig['canonicalize'][] = ['off', 'evidence', 'propose'];

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** รวมค่า patch ทับ base โดยตรวจชนิดและ clamp ทุกฟิลด์ตัวเลข */
export function mergeConfig(base: PipelineConfig, patch: unknown): PipelineConfig {
  const p = (patch ?? {}) as Record<string, unknown>;
  const dedupe = DEDUPE_MODES.includes(p.dedupe as PipelineConfig['dedupe'])
    ? (p.dedupe as PipelineConfig['dedupe'])
    : base.dedupe;
  const canonicalize = CANONICAL_MODES.includes(p.canonicalize as PipelineConfig['canonicalize'])
    ? (p.canonicalize as PipelineConfig['canonicalize'])
    : base.canonicalize;

  return {
    source: p.source === 'file' || p.source === 'db' ? p.source : base.source,
    dedupe,
    drop_invalid_identity:
      typeof p.drop_invalid_identity === 'boolean' ? p.drop_invalid_identity : base.drop_invalid_identity,
    build_similarity:
      typeof p.build_similarity === 'boolean' ? p.build_similarity : base.build_similarity,
    similarity_threshold: clampNumber(
      p.similarity_threshold,
      base.similarity_threshold,
      CONFIG_LIMITS.similarity_threshold.min,
      CONFIG_LIMITS.similarity_threshold.max,
    ),
    max_neighbors: Math.round(
      clampNumber(p.max_neighbors, base.max_neighbors, CONFIG_LIMITS.max_neighbors.min, CONFIG_LIMITS.max_neighbors.max),
    ),
    max_pair_candidates: Math.round(
      clampNumber(
        p.max_pair_candidates,
        base.max_pair_candidates,
        CONFIG_LIMITS.max_pair_candidates.min,
        CONFIG_LIMITS.max_pair_candidates.max,
      ),
    ),
    edge_min_confidence: clampNumber(
      p.edge_min_confidence,
      base.edge_min_confidence,
      CONFIG_LIMITS.edge_min_confidence.min,
      CONFIG_LIMITS.edge_min_confidence.max,
    ),
    attribute_overlap_min: clampNumber(
      p.attribute_overlap_min,
      base.attribute_overlap_min,
      CONFIG_LIMITS.attribute_overlap_min.min,
      CONFIG_LIMITS.attribute_overlap_min.max,
    ),
    gate_max_age_days: Math.round(
      clampNumber(
        p.gate_max_age_days,
        base.gate_max_age_days,
        CONFIG_LIMITS.gate_max_age_days.min,
        CONFIG_LIMITS.gate_max_age_days.max,
      ),
    ),
    variant_nodes: typeof p.variant_nodes === 'boolean' ? p.variant_nodes : base.variant_nodes,
    canonicalize,
    canonical_threshold: clampNumber(
      p.canonical_threshold,
      base.canonical_threshold,
      CONFIG_LIMITS.canonical_threshold.min,
      CONFIG_LIMITS.canonical_threshold.max,
    ),
    enrich_nodes: typeof p.enrich_nodes === 'boolean' ? p.enrich_nodes : base.enrich_nodes,
    enrich_min_confidence: clampNumber(
      p.enrich_min_confidence,
      base.enrich_min_confidence,
      CONFIG_LIMITS.enrich_min_confidence.min,
      CONFIG_LIMITS.enrich_min_confidence.max,
    ),
    ai_enrich: typeof p.ai_enrich === 'boolean' ? p.ai_enrich : base.ai_enrich,
    ai_min_confidence: clampNumber(
      p.ai_min_confidence,
      base.ai_min_confidence,
      CONFIG_LIMITS.ai_min_confidence.min,
      CONFIG_LIMITS.ai_min_confidence.max,
    ),
    ai_max_records_per_run: Math.round(
      clampNumber(
        p.ai_max_records_per_run,
        base.ai_max_records_per_run,
        CONFIG_LIMITS.ai_max_records_per_run.min,
        CONFIG_LIMITS.ai_max_records_per_run.max,
      ),
    ),
    ai_nodes: typeof p.ai_nodes === 'boolean' ? p.ai_nodes : base.ai_nodes,
    phrase_memory: typeof p.phrase_memory === 'boolean' ? p.phrase_memory : base.phrase_memory,
    ai_gate_min_text_fields: Math.round(
      clampNumber(
        p.ai_gate_min_text_fields,
        base.ai_gate_min_text_fields,
        CONFIG_LIMITS.ai_gate_min_text_fields.min,
        CONFIG_LIMITS.ai_gate_min_text_fields.max,
      ),
    ),
    ai_focus_ai_only: typeof p.ai_focus_ai_only === 'boolean' ? p.ai_focus_ai_only : base.ai_focus_ai_only,
    vision_enrich: typeof p.vision_enrich === 'boolean' ? p.vision_enrich : base.vision_enrich,
    vision_max_records_per_run: Math.round(
      clampNumber(
        p.vision_max_records_per_run,
        base.vision_max_records_per_run,
        CONFIG_LIMITS.vision_max_records_per_run.min,
        CONFIG_LIMITS.vision_max_records_per_run.max,
      ),
    ),
    build_graph: typeof p.build_graph === 'boolean' ? p.build_graph : base.build_graph,
  };
}

export interface ConfigPreset {
  id: 'default' | 'strict' | 'loose';
  label: string;
  description: string;
  config: PipelineConfig;
}

export function presetsFrom(base: PipelineConfig): ConfigPreset[] {
  return [
    {
      id: 'default',
      label: 'ค่าเริ่มต้น',
      description: 'สมดุลระหว่างจำนวนเส้นกับความแม่นยำ',
      config: { ...base },
    },
    {
      id: 'strict',
      label: 'เข้ม',
      description: 'จับคู่น้อยลงแต่ชัวร์กว่า (เหมาะกับสินค้าคล้ายกันเยอะ)',
      config: {
        ...base,
        similarity_threshold: 0.45,
        max_neighbors: 6,
        edge_min_confidence: 0.75,
        attribute_overlap_min: 0.8,
      },
    },
    {
      id: 'loose',
      label: 'ผ่อน',
      description: 'จับคู่มากขึ้นเพื่อหาเพื่อนบ้านให้ครบ (กราฟจะแน่นขึ้น)',
      config: {
        ...base,
        similarity_threshold: 0.25,
        max_neighbors: 12,
        edge_min_confidence: 0.5,
        attribute_overlap_min: 0.4,
      },
    },
  ];
}

export const CONFIG_LABELS: Record<string, string> = {
  source: 'แหล่งข้อมูล',
  dedupe: 'วิธีจัดการรายการซ้ำ',
  drop_invalid_identity: 'ตัดรายการที่ไม่มีรหัสสินค้า/ร้าน',
  build_similarity: 'สร้างความสัมพันธ์ระหว่างสินค้า',
  similarity_threshold: 'เกณฑ์ความคล้ายของชื่อ',
  max_neighbors: 'จำนวนเพื่อนบ้านสูงสุดต่อสินค้า',
  max_pair_candidates: 'จำนวนคู่ที่นำมาเทียบสูงสุด',
  edge_min_confidence: 'เกณฑ์ความมั่นใจขั้นต่ำของแท็กที่ใช้สร้าง edge',
  attribute_overlap_min: 'สัดส่วน attribute ที่ต้องทับซ้อนก่อนนับว่าคล้ายกัน',
  gate_max_age_days: 'อายุข้อมูลสูงสุด (วัน) ที่ Trust Gate ยอมรับ',
  variant_nodes: 'แสดงตัวเลือกสินค้าเป็นโหนด',
  canonicalize: 'จัดกลุ่ม listing ที่เป็นรุ่นเดียวกัน',
  canonical_threshold: 'เกณฑ์ความมั่นใจในการจัดกลุ่ม',
  enrich_nodes: 'แสดง use case / ฟังก์ชัน / บริบท / สไตล์ / ช่วงราคาเป็นโหนด',
  enrich_min_confidence: 'เกณฑ์ความมั่นใจขั้นต่ำของแท็กที่ตีความ',
  ai_enrich: 'ใช้ AI ช่วยสกัด attribute',
  ai_min_confidence: 'เกณฑ์ความมั่นใจขั้นต่ำของแท็กจาก AI',
  ai_max_records_per_run: 'จำนวนสินค้าที่ส่งให้ AI ต่อรอบ',
  ai_nodes: 'แสดงค่าที่ AI อนุมานเป็นโหนด (แยกจากหลักฐาน)',
  phrase_memory: 'ใช้พจนานุกรมวลีที่เรียนรู้จากผล AI (ประหยัดค่า API)',
  ai_gate_min_text_fields: 'จำนวนกลุ่ม attribute หลัก (ใช้ทำอะไร/ใช้ที่ไหน) ที่กฎต้องเจอก่อนข้าม AI',
  ai_focus_ai_only: 'แถวที่ถูกข้าม ยังขอเฉพาะค่าที่กฎสร้างไม่ได้',
  vision_enrich: 'อ่านรูปภาพด้วย VLM (ใช้ AI_API_KEY ของ DeepSeek ได้)',
  vision_max_records_per_run: 'จำนวนสินค้าที่ส่งให้ VLM ต่อรอบ',
  build_graph: 'สร้างกราฟ',
};
