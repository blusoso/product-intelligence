/**
 * Network-ready data model (PI Admin)
 * ----------------------------------
 * ข้อมูลสินค้าดิบจาก extension → canonical product → graph nodes/edges
 * ทุก record ต้องมี "ตัวตน" (identity) และ "คุณภาพ" (quality) ติดไปด้วย
 * เพื่อให้ graph ที่สร้างต่อมี provenance ตรวจย้อนกลับได้
 */

export type Severity = 'critical' | 'warning' | 'info';

export type SourceId = 'db' | 'file';

export type NodeType =
  | 'product'
  | 'variant'
  | 'shop'
  | 'brand'
  | 'category'
  | 'product_type'
  | 'province'
  | 'region'
  | 'use_case'
  | 'function'
  | 'context'
  | 'style'
  | 'space'
  | 'audience'
  | 'price_segment'
  | 'ai_attribute';

export type EdgeType =
  | 'sold_by'
  | 'variant_of'
  | 'same_product_as'
  | 'brand_of'
  | 'in_category'
  | 'has_type'
  | 'located_in'
  | 'shop_located_in'
  | 'part_of_region'
  | 'subtype_of'
  | 'similar_to'
  | 'substitute'
  | 'complements'
  | 'same_context'
  | 'used_with'
  | 'used_for'
  | 'has_function'
  | 'fits_context'
  | 'has_style'
  | 'fits_space'
  | 'targets_audience'
  | 'in_price_segment'
  | 'ai_about';

/* ── Trust Gate (ด่านก่อนจัดอันดับ) ─────────────────────────── */

export type GateStatus = 'pass' | 'review' | 'blocked';

export type TrustRiskLevel = 'low' | 'medium' | 'high';

/** ความเสี่ยงที่ตรวจได้จากรีวิว/นโยบายร้าน/ความสอดคล้องของข้อมูล — ไม่ใช่ popularity */
export type TrustRiskFlag =
  | 'has_damage_complaints'
  | 'severe_damage_cluster'
  | 'strict_return_policy'
  | 'unavailable'
  | 'sold_inconsistent';

export interface TrustRiskQuote {
  rating: number;
  comment: string;
  terms: string[];
}

export interface TrustRisk {
  level: TrustRiskLevel;
  flags: TrustRiskFlag[];
  review: {
    /** จำนวนรีวิวที่มีข้อความ (หลัง dedupe) */
    sampled: number;
    /** จำนวนรีวิว 1–2 ดาวที่มีข้อความ */
    low_star: number;
    damage_mentions: number;
    /** damage_mentions / low_star (0..1) — ใช้ sample ที่ถูกสุ่มมา ไม่ใช่ review_count ทั้งหมด */
    damage_share_low_star: number;
    quotes: TrustRiskQuote[];
  };
  policy: {
    strict_return: boolean;
    claim_support: boolean;
    evidence: string | null;
    source: 'description' | 'none';
  };
  availability: {
    unavailable: boolean;
    in_stock: boolean;
  };
  sold: {
    monthly_gt_historical: boolean;
  };
  distribution: {
    /** share ของ 1–2 ดาวจาก rating_dist ทั้งหมด (0..1) */
    low_star_share: number | null;
  };
  datasource_tier: string | null;
  seller_flag: string | null;
}

export interface GateCheck {
  id: string;
  result: 'pass' | 'warn' | 'fail';
  detail?: string;
}

export interface GateResult {
  status: GateStatus;
  /** รหัสเหตุผลที่อ่านได้ (เช่น out_of_stock, stale_data) */
  reasons: string[];
  checks: GateCheck[];
  /** risk flags ที่มีผลต่อการตัดสิน (แม้ gate = pass) */
  risk_flags?: TrustRiskFlag[];
  risk_level?: TrustRiskLevel | null;
  checked_at: string;
}

/* ── Opportunity (Proven / Hidden / Emerging) ───────────────── */

export type OpportunityClass = 'proven' | 'hidden' | 'emerging';

export interface OpportunityMetrics {
  degree: number;
  strength: number;
  pagerank: number;
  degree_pct: number;
  sold_pct: number;
  context_demand_pct: number;
  audience_fit: number;
  audience_fit_basis: 'audience' | 'context_fallback' | 'none';
  audience: string | null;
  rating: number | null;
  listing_age_days: number | null;
  /** ระดับความเสี่ยงจาก Trust Risk (ไม่ใช่ popularity) */
  risk_level: TrustRiskLevel | null;
  /** คะแนนที่ถูกลดเพราะความเสี่ยง 0..1 */
  risk_penalty: number;
}

export interface OpportunityEvidence {
  edge_type: EdgeType;
  weight: number;
  other: { node_key: string; name: string; url: string };
  shared: { contexts: string[]; use_cases: string[]; functions: string[] };
  quote?: string;
}

export interface Opportunity {
  node_key: string;
  ext: string;
  name: string;
  image: string | null;
  url: string;
  price: number;
  historical_sold: number;
  class: OpportunityClass;
  /** alias ของ class — ใช้แยกจาก datasource_tier ให้ชัดเจน */
  internal_tier: OpportunityClass;
  /** tier จาก datasource (PROVEN/GEM) — popularity only */
  datasource_tier: string | null;
  score: number;
  gate: GateResult;
  trust_risk: TrustRisk | null;
  metrics: OpportunityMetrics;
  evidence: OpportunityEvidence[];
  explain_th: string;
}

export interface OpportunityDiagnostics {
  note: string | null;
  min_listing_age_days: number | null;
  age_unknown: number;
  gate_review_count: number;
  risk_counts: Record<TrustRiskLevel, number>;
  review_coverage: {
    with_samples: number;
    without_reviews: number;
    with_policy_text: number;
  };
  datasource_tier_counts: Record<string, number>;
  edge_counts_by_type: Record<string, number>;
  thresholds: Record<string, number>;
}

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  count: number;
  samples: any[];
  auto_fixable: boolean;
  /** rule id ที่ pipeline ใช้แก้ (ถ้า auto_fixable) */
  fix?: string;
  /** สัดส่วนของ records ที่พบปัญหา 0..1 */
  ratio?: number;
}

export interface AuditSection {
  id: string;
  title: string;
  icon: string;
  score: number;
  findings: Finding[];
}

export interface DimensionScore {
  id: string;
  label: string;
  score: number;
  weight: number;
}

export interface Projection {
  node_count: number;
  edge_count: number;
  by_node_type: Record<string, number>;
  by_edge_type: Record<string, number>;
  isolates: number;
  isolate_ratio: number;
  avg_degree: number;
  components: number;
}

export interface AuditReport {
  generated_at: string;
  source: string;
  total: number;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readiness: number;
  summary: { critical: number; warning: number; info: number };
  dimensions: DimensionScore[];
  sections: AuditSection[];
  projection?: Projection;
}

export interface CleanChange {
  product_id: any;
  field: string;
  before: any;
  after: any;
  rule: string;
}

export interface DroppedRecord {
  product_id: any;
  name: string;
  reason: string;
  original?: any;
}

export interface MergeRecord {
  key: string;
  kept_from: any;
  merged: number;
  product_ids: any[];
}

export interface SpecPair {
  name: string;
  value: string;
}

/** ตัวเลือก (variant/SKU) ของ listing — ราคาและขนาดแยกตามตัวเลือก */export interface ProductVariant {
  model_id: string;
  name: string;
  price: number | null;
  stock: number | null;
  stock_known: boolean;
  available: boolean;
  color: string | null;
  size_label: string | null;
  width_cm: number | null;
  depth_cm: number | null;
}

export interface PriceHistorySummary {
  observations: number;
  min: number;
  max: number;
  last_change_pct: number | null;
  last_observed_at: string | null;
}

/** สรุปการจัดกลุ่ม canonical product ของทั้งชุด */
export interface CanonicalSummary {
  groups: number;
  listings_in_groups: number;
  linked: number;
  proposals: number;
  ambiguous: string[];
}

/**
 * ค่าที่สกัดจากข้อความ (ชื่อ/สเปก/ตัวเลือก) พร้อมหลักฐาน
 * - value = ป้ายที่อ่านรู้เรื่อง (ไทย) ใช้เป็น label ของ node
 * - id = ค่าคงที่สำหรับอ้างอิง (ใช้สร้าง node id)
 */
export interface EnrichedTag {
  id: string;
  value: string;
  confidence: number;
  /** ที่มาของหลักฐาน เช่น "ชื่อ: อ่านหนังสือ", "สเปก: การใช้งาน=ตั้งโต๊ะ" */
  evidence: string[];
  /** id ของกฎ heuristic ที่เติมค่านี้ (ไม่มี = มาจากพจนานุกรมคำ) */
  rule?: string;
}

/**
 * ช่วงราคาเทียบกับตลาดของหมวดเดียวกัน (ไม่ใช่เกณฑ์คงที่)
 * - market: เทียบกับ median/quantile ของหมวด (sample พอ)
 * - absolute: หมวดมี sample น้อย จึงใช้เกณฑ์ราคาคงที่
 */
export interface PriceSegment {
  label: 'Budget' | 'Value' | 'Mid' | 'Premium' | 'Luxury' | 'Unknown';
  basis: 'market' | 'absolute' | 'unknown';
  /** ตำแหน่งของราคาในช่วง 0..1 (null = ไม่ทราบ) */
  percentile: number | null;
  /** จำนวนสินค้าในหมวดที่ใช้คำนวณ */
  sample: number;
  /** median ของหมวด (บาท) */
  median: number | null;
}

/** Product Understanding & Enrichment — ค่าที่ตีความแล้ว ไม่ใช่ข้อมูลดิบ */
export interface ProductEnrichment {
  use_cases: EnrichedTag[];
  functions: EnrichedTag[];
  contexts: EnrichedTag[];
  styles: EnrichedTag[];
  spaces: EnrichedTag[];
  /** กลุ่มผู้ใช้ที่ rule ตรวจได้ (student/kids/baby ฯลฯ) — แยกจาก AI */
  audiences: EnrichedTag[];
  /** บริบทเป้าหมาย = context + เงื่อนไขพื้นที่ เช่น "ห้องนอน · พื้นที่จำกัด" */
  target_contexts: EnrichedTag[];
  price_segment: PriceSegment;
}

/**
 * ค่าที่ AI สกัด/อนุมาน — แยก namespace จาก enrichment (หลักฐาน) โดยเด็ดขาด
 * - value_id ต้องอยู่ใน vocabulary เท่านั้น
 * - grounded=true แปลว่ามี quote ที่พบจริงในข้อความ; false = เป็นการอนุมาน
 * - ไม่มีฟิลด์ตัวเลข/การวัดใด ๆ โดยเจตนา (กัน AI เดาขนาด/ราคา)
 */
export interface AiTag {
  attribute: AttrIdAlias;
  value_id: string;
  value: string;
  confidence: number;
  grounded: boolean;
  quote?: string;
  /** true = ขัดกับค่าที่ rule ตรวจได้ (rule ยังเป็นตัวจริง) */
  conflict?: boolean;
  /** ที่มาของ grounding: ข้อความ (quote) หรือภาพ (region/bbox) — default 'text' */
  evidence_type?: 'text' | 'image';
  /** ภาพเท่านั้น: ตำแหน่งในภาพที่เห็นค่านั้น เป็นข้อความไทย เช่น "ขอบบนซ้าย" */
  region?: string;
  /** ภาพเท่านั้น: พิกัด normalized 0..1 */
  bbox?: AiTagBBox;
  /** ภาพเท่านั้น: url ของภาพที่ใช้ตัดสิน */
  image?: string;
  /** แหล่งที่มาของแท็ก: ai (เรียกโมเดล), phrase (พจนานุกรมวลี), vision (อ่านภาพ) */
  origin?: 'ai' | 'phrase' | 'vision';
}

/** พิกัดในภาพ แบบ normalized 0..1 (มุมซ้ายบนเป็นจุดเริ่ม) */
export interface AiTagBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AiEnrichment {
  tags: AiTag[];
  meta: {
    provider: string;
    model: string;
    prompt_version: string;
    at: string;
    status: 'ok' | 'partial' | 'error' | 'disabled';
    cached: boolean;
    error?: string;
    /** เวอร์ชันพจนานุกรมวลี/การทำข้อความให้เป็นมาตรฐานที่ใช้ตอนสร้างแท็ก */
    phrase_version?: string;
    /** สรุปผลการอ่านภาพ (ถ้าเคยรัน) */
    vision?: {
      model: string;
      prompt_version: string;
      at: string;
      /** จำนวนรูปที่ส่งให้โมเดลในรอบนั้น */
      images: number;
      region?: boolean;
    };
  };
}

/** alias เพื่อไม่ให้ types.ts ต้อง import vocab (ซึ่ง import types) */
export type AttrIdAlias =
  | 'use_case'
  | 'function'
  | 'context'
  | 'style'
  | 'space'
  | 'audience'
  | 'occasion'
  | 'adjustability'
  | 'power_source'
  | 'assembly'
  | 'finish'
  | 'visual_features'
  | 'material_visual';

/** ที่มาของค่าใน Product Attributes */
export type AttributeSource = 'evidence' | 'computed' | 'ai_inferred' | 'manual';

/** override ที่ admin แก้เอง (เก็บใน products.attribute_overrides) */
export interface AttributeOverride {
  values: Array<{ value_id: string; label: string }>;
  at: string;
  by: string;
  note?: string;
}

export type AttributeOverrideMap = Record<string, AttributeOverride>;

/** ค่า 1 ค่าของ attribute พร้อมป้ายที่มา */
export interface AttributeValue {
  value_id: string;
  label: string;
  source: AttributeSource;
  confidence: number;
  /** หลักฐาน: คำที่พบ (rule) หรือ quote (AI) หรือเกณฑ์คำนวณ (computed) */
  evidence?: string[];
  /** AI เท่านั้น: quote พบจริงในข้อความหรือไม่ */
  grounded?: boolean;
  /** AI เท่านั้น: ขัดกับค่าที่ตรวจสอบได้ */
  conflict?: boolean;
  /** AI เท่านั้น: หลักฐานมาจากข้อความหรือภาพ (ภาพ = ใช้ region/bbox แทน quote) */
  evidence_type?: 'text' | 'image';
  ai_model?: string;
}

/** attribute 1 ตัวของสินค้า 1 ชิ้น (มีครบทุกตัวแม้ค่าจะว่าง) */
export interface ProductAttribute {
  attribute: string;
  label: string;
  values: AttributeValue[];
  status: 'evidence' | 'computed' | 'ai' | 'mixed' | 'manual' | 'none';
  /** true = ค่าที่แสดงถูกแก้โดย admin (แทนที่หลักฐาน/AI ของ attribute นี้) */
  overridden?: boolean;
  /** จำนวนค่าที่ถูกแทนที่ด้วย override */
  superseded?: number;
}

export interface AttributeCoverage {
  attribute: string;
  label: string;
  total: number;
  evidence: number;
  ai: number;
  computed: number;
  /** นับเฉพาะแถวที่ admin แก้เอง (override) */
  manual: number;
  none: number;
}


export interface ProductFeatures {
  price_band: 'Invalid' | 'Budget' | 'Cheap' | 'Mid' | 'Premium' | 'Luxury';
  velocity_band: 'None' | 'Legacy' | 'Slow' | 'Normal' | 'Fast' | 'New';
  age_band: string;
  trust_band: 'Poor' | 'Fair' | 'Good' | 'Excellent';
  name_length: number;
  name_tokens: number;
  spec_count: number;
  option_count: number;
  gmv_monthly: number;
  sold_ratio: number | null;
}

export interface NormalizedProduct {
  node_key: string;
  ext: string;
  product_id: string;
  shop_id: string;
  platform: string;
  shop_name: string;
  name: string;
  name_raw: string;
  name_tokens: string[];
  category: string;
  category_confidence: number;
  product_type: string;
  type_confidence: number;
  brand: string | null;
  brand_confidence: number;
  /** หลักฐานที่มาของแบรนด์ (source: evidence) — ไม่ persisted แยก */
  brand_evidence: string | null;
  province: string;
  region: string;
  /** หลักฐานที่มาของจังหวัด เช่น "location: กรุงเทพมหานคร" */
  province_evidence: string | null;
  price: number;
  price_before_discount: number | null;
  discount_pct: number;
  /** สกุลเงินที่ตรวจได้ (ไม่แปลงอัตราแลกเปลี่ยน) */
  currency: string;
  /** ข้อความราคาต้นฉบับ เก็บไว้ตรวจย้อน */
  price_raw_text: string;
  price_source: 'item' | 'variant_min';
  /** ขนาดที่แปลงเป็น ซม. แล้ว (null = ไม่พบ/ไม่มั่นใจ) */
  width_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  size_label: string | null;
  size_source: 'spec' | 'option' | 'title' | null;
  size_confidence: number;
  /** ขนาดที่พบในตัวเลือก เมื่อตัวเลือกมีหลายขนาด */
  size_options: string[];
  /** ตัวเลือก/SKU ทั้งหมดของ listing */
  variants: ProductVariant[];
  variant_count: number;
  variant_price_min: number | null;
  variant_price_max: number | null;
  variant_axes: string[];
  /** กลุ่มสินค้ารุ่นเดียวกัน (canonical product) — null = ยังไม่จัดกลุ่ม */
  canonical_id: string | null;
  canonical_confidence: number;
  /** หลักฐานที่ใช้จัดกลุ่ม เช่น model_code:DD-190 */
  canonical_evidence: string | null;
  listing_count: number;
  is_primary_listing: boolean;
  /** สรุปประวัติราคา (คำนวณตอน build จาก price-history.jsonl) */
  price_history?: PriceHistorySummary | null;
  monthly_sold: number;
  historical_sold: number;
  rating: number | null;
  review_count: number;
  trust_score: number;
  /** tier จาก datasource เช่น PROVEN/GEM — เป็น popularity tier ไม่ใช่ trust ภายใน */
  datasource_tier?: string | null;
  /** สถานะร้านจาก datasource เช่น PREFERRED/OFFICIAL_SHOP */
  seller_flag?: string | null;
  /** datasource บอกว่าสินค้าไม่พร้อมขาย (แยกจาก in_stock) */
  is_unavailable?: boolean;
  listing_age_days: number | null;
  in_stock: boolean;
  is_ad: boolean;
  shopee_verified: boolean;
  url: string;
  /** รูปหน้าปก (ใช้แสดงผล/การ์ดสินค้า) */
  image: string | null;
  /**
   * รูปทั้งหมดของ listing (cap 8, เฉพาะ http/https)
   * ใช้เลือก "รูปที่จะส่งให้ VLM อ่าน" — ไม่ได้เขียนกลับ DB (DB มี images_all อยู่แล้ว)
   */
  images: string[];
  title_length: number;
  spec_count: number;
  option_count: number;
  /** ข้อความบรรยายจาก marketplace (ตัด 4,000) — หลักฐานสำหรับ AI */
  description: string;
  materials: string[];
  colors: string[];
  /** @deprecated ใช้ enrichment.contexts[0] — เก็บไว้ให้โค้ด/UI เดิมอ่านได้ */
  room: string | null;
  /** @deprecated ใช้ enrichment.styles[0] */
  style: string | null;
  /** Product Understanding & Enrichment (use case/function/context/style/space/price segment) */
  enrichment: ProductEnrichment;
  /** ค่าที่ AI สกัด/อนุมาน — แยกจาก enrichment เสมอ (null = ยังไม่ได้ทำ) */
  ai: AiEnrichment | null;
  /** ค่าที่ admin แก้เอง — ชนะหลักฐาน/คำนวณ/AI ของ attribute เดียวกัน */
  overrides?: AttributeOverrideMap | null;
  specs: SpecPair[];
  features: ProductFeatures;
  quality_score: number;
  completeness: number;
  quality_flags: string[];
  repaired: string[];
  ingested_at: string | null;
  updated_at: string | null;
  /** เวลาที่ระบบเห็น listing นี้ครั้งแรก (ใช้ตัดสิน Emerging เมื่อ listing_age_days ไม่มี) */
  first_seen_at?: string | null;
  /** ผล Trust Gate — เติมโดย pipeline ทุกรอบ (null = ยังไม่ประเมิน) */
  gate?: GateResult | null;
  /** ความเสี่ยงจากรีวิว/นโยบายร้าน — คำนวณตอน normalize */
  trust_risk?: TrustRisk | null;
  /** alias ของ opportunity.class — internal tier (ไม่ใช่ tier จาก datasource) */
  internal_tier?: OpportunityClass | null;
  /** ผลจัดประเภทโอกาส — เติมเฉพาะรอบที่สร้าง graph */
  opportunity?: {
    class: OpportunityClass;
    score: number;
    metrics: OpportunityMetrics;
  } | null;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  /** ค่าที่ใช้วัดความสำคัญของ node (เช่น ยอดขาย, จำนวนสินค้าในร้าน) */
  weight: number;
  attributes: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  directed: boolean;
  evidence: Record<string, any>;
}

export interface Hub {
  id: string;
  label: string;
  type: NodeType;
  degree: number;
  weight: number;
}

export interface NetworkStats {
  node_count: number;
  edge_count: number;
  product_count: number;
  by_node_type: Record<string, number>;
  by_edge_type: Record<string, number>;
  density: number;
  avg_degree: number;
  max_degree: number;
  isolates: string[];
  isolate_ratio: number;
  components: number;
  component_sizes: number[];
  largest_component: number;
  clustering: number;
  top_hubs: Hub[];
  readiness: number;
  readiness_breakdown: Record<string, number>;
  /** จำนวนสินค้าตามผล Trust Gate (จาก product node attributes) */
  by_gate_status?: Record<GateStatus, number>;
  /** จำนวนสินค้าตามระดับความเสี่ยง */
  by_risk_level?: Record<TrustRiskLevel, number>;
}

export interface Graph {
  directed: boolean;
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: NetworkStats;
}

export interface PipelineConfig {
  source: SourceId;
  /** รวม record ซ้ำ (product_id เดียวกัน) แทนการทิ้ง */
  dedupe: 'merge' | 'keep-first' | 'keep-richest';
  /** ทิ้ง record ที่ไม่มี identity (product_id/shop_id) */
  drop_invalid_identity: boolean;
  /** สร้าง similarity edges ระหว่างสินค้า */
  build_similarity: boolean;
  similarity_threshold: number;
  max_neighbors: number;
  /** จำนวนสินค้าสูงสุดที่ใช้จับคู่ (กัน O(n²) ระเบิด) */
  max_pair_candidates: number;
  /** เกณฑ์ความมั่นใจขั้นต่ำของแท็กที่ใช้สร้าง edge (หลักฐานจาก rule) */
  edge_min_confidence: number;
  /** Jaccard ขั้นต่ำของ enriched attributes ก่อนสร้าง similar/substitute */
  attribute_overlap_min: number;
  /** อายุข้อมูลสูงสุด (วัน) ที่ Trust Gate ยอมรับ */
  gate_max_age_days: number;
  /** แสดงตัวเลือก (variant) เป็นโหนดในกราฟ */
  variant_nodes: boolean;
  /** จัดกลุ่ม listing ที่เป็นสินค้ารุ่นเดียวกัน */
  canonicalize: 'off' | 'evidence' | 'propose';
  /** เกณฑ์ความมั่นใจขั้นต่ำสำหรับการจัดกลุ่ม */
  canonical_threshold: number;
  /** แสดง use case / function / context / style / space / price segment เป็นโหนด */
  enrich_nodes: boolean;
  /** เกณฑ์ความมั่นใจขั้นต่ำของ tag ที่จะสร้างเป็นโหนด */
  enrich_min_confidence: number;
  /** เปิดใช้ AI ช่วยสกัด attribute (ต้องมี AI_API_KEY) */
  ai_enrich: boolean;
  /** เกณฑ์ความมั่นใจขั้นต่ำของแท็กที่มาจาก AI */
  ai_min_confidence: number;
  /** จำนวน record สูงสุดที่ส่งให้ AI ต่อรอบ */
  ai_max_records_per_run: number;
  /** สร้างโหนด ai_attribute จากค่าที่ AI อนุมาน (แยกจากโหนดหลักฐาน) */
  ai_nodes: boolean;
  /** ใช้พจนานุกรมวลีที่เรียนรู้จากผล AI รอบก่อน (ต้อง grounding ซ้ำทุกครั้ง) */
  phrase_memory: boolean;
  /** ถ้ากฎสกัดได้ครบ ≥ จำนวนนี้ (จาก 5 กลุ่ม) ให้ข้ามการเรียก AI แบบเต็ม */
  ai_gate_min_text_fields: number;
  /** true = แถวที่ถูก gate ยังได้ focus pass เฉพาะ attribute ที่กฎสร้างไม่ได้ */
  ai_focus_ai_only: boolean;
  /** เปิดใช้การอ่านภาพด้วย VLM (ใช้ AI_API_KEY ของ DeepSeek ได้ ไม่ต้องมี key แยก) */
  vision_enrich: boolean;
  /** จำนวน record สูงสุดที่ส่งให้ VLM ต่อรอบ (คุมต้นทุน) */
  vision_max_records_per_run: number;
  /** สร้าง graph หรือไม่ (false = เฉพาะ normalize/audit/DB) */
  build_graph: boolean;
}

export interface PipelineResult {
  source: SourceId;
  generated_at: string;
  input_count: number;
  kept_count: number;
  dropped: DroppedRecord[];
  merged: MergeRecord[];
  changes: CleanChange[];
  report_before: AuditReport;
  report_after: AuditReport;
  products: NormalizedProduct[];
  graph: Graph | null;
  canonical: CanonicalSummary;
  elapsed_ms: number;
  config: PipelineConfig;
}

/** 1 บรรทัดใน data/network/runs.jsonl — ประวัติการรัน pipeline */
export interface NetworkRun {
  id: string;
  at: string;
  source: SourceId;
  input: number;
  kept: number;
  nodes: number;
  edges: number;
  readiness: number;
  score_before: number;
  score_after: number;
  elapsed_ms: number;
  snapshot: string | null;
  config: PipelineConfig;
  sync: { mode: SyncMode; updated: number; failed: number } | null;
  /** ที่มาของการรัน: อัตโนมัติหลัง ingest / สร้างกราฟ / เขียน DB */
  kind?: 'auto' | 'graph' | 'sync';
  graph_built?: boolean;
}

export type SyncMode = 'core' | 'normalized' | 'both';

export interface NetworkSnapshot {
  meta: {
    generated_at: string;
    source: SourceId;
    version: string;
    products: number;
    nodes: number;
    edges: number;
    quality_score: number;
    readiness: number;
  };
  graph: Graph;
  report: AuditReport;
  records: NormalizedProduct[];
  dropped: DroppedRecord[];
  merged: MergeRecord[];
  changes: CleanChange[];
  /** ผลจัดประเภท Proven / Hidden / Emerging (เฉพาะรอบที่สร้าง graph) */
  opportunities?: Opportunity[];
  diagnostics?: OpportunityDiagnostics;
}
