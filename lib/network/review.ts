/**
 * Review workbench — ประกอบข้อมูลสำหรับหน้าตรวจ/อนุมัติสินค้า
 *
 * หลักการ:
 *  - อ่านค่าที่ pipeline เคยคำนวณไว้แล้ว (products.enrichment / ai_enrichment)
 *    ไม่รัน pipeline ใหม่ทั้งชุด → เปิดรายละเอียดได้เร็ว และตัวเลขตรงกับ DB
 *  - ถ้าแถวนั้นยังไม่เคยประมวลผล (enrichment ว่าง) ค่อยคำนวณสดจากแถวเดียว
 *  - ค่าที่ admin แก้ (attribute_overrides) ถูกใช้แทนค่าอื่นของ attribute เดียวกัน
 */
import type { NormalizedProduct, ProductAttribute, ProductEnrichment } from './types';
import { ATTRIBUTE_DEFS, buildProductAttributes } from './attributes';
import { PRODUCT_TYPES, PROVINCES, BRANDS, typeCategory } from './taxonomy';
import { ATTRIBUTE_MAP } from './vocab';

const NULL_SEGMENT: ProductEnrichment['price_segment'] = {
  label: 'Unknown',
  basis: 'unknown',
  percentile: null,
  sample: 0,
  median: null,
};

const EMPTY_ENRICHMENT: ProductEnrichment = {
  use_cases: [],
  functions: [],
  contexts: [],
  styles: [],
  spaces: [],
  audiences: [],
  target_contexts: [],
  price_segment: NULL_SEGMENT,
};

/** enrichment จาก DB อาจว่าง/รูปทรงเพี้ยน — เติมค่าเริ่มต้นให้ครบทุกคีย์ */
function asEnrichment(v: any): ProductEnrichment | null {
  if (!v || typeof v !== 'object') return null;
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  const seg = v.price_segment && typeof v.price_segment === 'object' ? v.price_segment : NULL_SEGMENT;
  const hasAny =
    arr(v.use_cases).length ||
    arr(v.functions).length ||
    arr(v.contexts).length ||
    arr(v.styles).length ||
    arr(v.spaces).length ||
    arr(v.audiences).length ||
    arr(v.target_contexts).length ||
    (seg.label && seg.label !== 'Unknown');
  if (!hasAny) return null;
  return {
    use_cases: arr(v.use_cases),
    functions: arr(v.functions),
    contexts: arr(v.contexts),
    styles: arr(v.styles),
    spaces: arr(v.spaces),
    audiences: arr(v.audiences),
    target_contexts: arr(v.target_contexts),
    price_segment: { ...NULL_SEGMENT, ...seg },
  };
}

export interface ReviewCounts {
  /** จำนวน attribute ที่มีค่าอย่างน้อย 1 ค่า (จากจำนวนทั้งชุดใน ATTRIBUTE_DEFS) */
  attributes_filled: number;
  /** จำนวนค่าที่มาจาก AI */
  ai_values: number;
  /** จำนวนค่าที่มาจากข้อความ/คำนวณ (ตรวจสอบได้) */
  verified_values: number;
  /** จำนวน attribute ที่ admin แก้เอง */
  overridden: number;
  /** ช่องบังคับที่ยังว่าง (ใช้เตือนก่อนอนุมัติ) */
  missing_fields: string[];
}

export interface ReviewDetail {
  attributes: ProductAttribute[];
  /** true = อ่านจาก enrichment ที่บันทึกไว้, false = คำนวณสดจากแถวเดียว */
  from_db: boolean;
  counts: ReviewCounts;
  ai_meta: Record<string, any> | null;
}

/**
 * สร้างข้อมูลตรวจสอบจากแถว products (ไม่แตะ DB, ไม่รัน pipeline เต็มชุด)
 */
export function buildReviewDetail(row: Record<string, any>): ReviewDetail {
  const enrichment = asEnrichment(row.enrichment);
  const ai = row.ai_enrichment && Array.isArray(row.ai_enrichment.tags) ? row.ai_enrichment : null;
  const productType = String(row.product_type ?? '');

  const pseudo = {
    node_key: String(row.network_node_key ?? ''),
    ext: String(row.ext ?? ''),
    name: String(row.name ?? ''),
    category: typeCategory(productType),
    category_confidence: Number(row.category_confidence ?? 0),
    product_type: productType,
    type_confidence: Number(row.category_confidence ?? 0),
    brand: row.brand ?? null,
    brand_confidence: 0,
    province: String(row.province ?? ''),
    price: Number(row.price ?? 0),
    currency: String(row.currency ?? 'THB'),
    width_cm: row.width_cm ?? null,
    depth_cm: row.depth_cm ?? null,
    height_cm: row.height_cm ?? null,
    size_label: row.size_label ?? null,
    size_source: null,
    size_confidence: 1,
    description: String(row.description ?? ''),
    image: row.image ?? null,
    images: [
      ...(Array.isArray(row.images_all) ? row.images_all : []),
      row.image,
    ]
      .map((x: any) => (typeof x === 'string' ? x : x?.url ? String(x.url) : ''))
      .filter((u: string) => /^https?:\/\//i.test(u)),
    enrichment: enrichment ?? EMPTY_ENRICHMENT,
    ai,
    overrides: row.attribute_overrides ?? null,
  } as unknown as NormalizedProduct;

  const attributes = buildProductAttributes(pseudo);

  let aiValues = 0;
  let verified = 0;
  let filled = 0;
  let overridden = 0;
  for (const a of attributes) {
    if (a.values.length) filled += 1;
    if (a.overridden) overridden += 1;
    for (const v of a.values) {
      if (v.source === 'ai_inferred') aiValues += 1;
      else verified += 1;
    }
  }

  const missing: string[] = [];
  if (!pseudo.name.trim()) missing.push('ชื่อสินค้า');
  if (!productType || productType === 'other') missing.push('ประเภทสินค้า');
  if (!(pseudo.price > 0)) missing.push('ราคา');
  if (!pseudo.province || pseudo.province === 'ไม่ระบุ') missing.push('จังหวัด');

  return {
    attributes,
    from_db: Boolean(enrichment),
    counts: {
      attributes_filled: filled,
      ai_values: aiValues,
      verified_values: verified,
      overridden,
      missing_fields: missing,
    },
    ai_meta: ai?.meta ?? null,
  };
}

/** ตัวเลือกสำหรับฟอร์มแก้ไข (ส่งให้ UI ครั้งเดียว) */
export function reviewOptions() {
  const vocab: Record<string, Array<{ id: string; label: string }>> = {};
  for (const a of ATTRIBUTE_DEFS) {
    const def = (ATTRIBUTE_MAP as Record<string, { values?: Array<{ id: string; label: string }> }>)[a.id];
    if (def?.values) vocab[a.id] = def.values.map((v) => ({ id: v.id, label: v.label }));
  }
  return {
    product_types: PRODUCT_TYPES.map((t) => ({ id: t.id, label: t.label, category: t.category })),
    brands: BRANDS,
    provinces: PROVINCES.map((p) => ({ th: p.th, region: p.region })),
    attributes: ATTRIBUTE_DEFS.map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
    vocab,
  };
}

/* ── ฟิลด์ที่ admin แก้ได้ + การตรวจค่า ─────────────────────── */

const PRODUCT_TYPE_IDS = new Set(PRODUCT_TYPES.map((t) => t.id));
const PROVINCE_SET = new Set(PROVINCES.map((p) => p.th));

export interface EditResult {
  fields: Record<string, any>;
  changed: string[];
  error?: string;
}

/**
 * ตรวจ/ทำความสะอาดค่าที่จะเขียนลง products
 * - ไม่รับฟิลด์ที่อยู่นอก whitelist (กันการเขียนทับตัวเลขที่ scrape มา)
 * - คืนเฉพาะคีย์ที่ค่าปัจจุบันต่างจริง (เอาไปทำ manual_edits)
 */
export function sanitizeEdits(body: Record<string, any>, current: Record<string, any>): EditResult {
  const fields: Record<string, any> = {};
  const changed: string[] = [];
  const set = (key: string, value: any) => {
    const before = current[key] ?? null;
    const after = value ?? null;
    const same =
      typeof before === 'number' || typeof after === 'number'
        ? Number(before) === Number(after)
        : String(before ?? '') === String(after ?? '');
    if (same) return;
    fields[key] = after;
    changed.push(key);
  };

  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return { fields, changed, error: 'ชื่อสินค้าว่างไม่ได้' };
    if (name.length > 300) return { fields, changed, error: 'ชื่อสินค้ายาวเกิน 300 ตัวอักษร' };
    set('name', name);
  }
  if ('sku' in body) {
    const sku = String(body.sku ?? '').trim();
    if (!sku) return { fields, changed, error: 'SKU ว่างไม่ได้' };
    if (sku.length > 120) return { fields, changed, error: 'SKU ยาวเกิน 120 ตัวอักษร' };
    set('sku', sku);
  }
  if ('price' in body) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 10_000_000) {
      return { fields, changed, error: 'ราคาต้องเป็นตัวเลข 0–10,000,000' };
    }
    set('price', Math.round(price * 100) / 100);
  }
  if ('commission_per_unit' in body) {
    const cm = Number(body.commission_per_unit);
    if (!Number.isFinite(cm) || cm < 0 || cm > 1_000_000) {
      return { fields, changed, error: 'ค่าคอมต้องเป็นตัวเลข 0–1,000,000' };
    }
    set('commission_per_unit', Math.round(cm * 100) / 100);
  }
  if ('product_type' in body) {
    const type = String(body.product_type ?? '').trim();
    if (!PRODUCT_TYPE_IDS.has(type) && type !== 'other') {
      return { fields, changed, error: `ไม่รู้จักประเภทสินค้า "${type}"` };
    }
    set('product_type', type);
  }
  if ('brand' in body) {
    const brand = String(body.brand ?? '').trim();
    if (brand.length > 120) return { fields, changed, error: 'แบรนด์ยาวเกิน 120 ตัวอักษร' };
    set('brand', brand || null);
  }
  if ('province' in body) {
    const province = String(body.province ?? '').trim();
    if (province && province !== 'ไม่ระบุ' && !PROVINCE_SET.has(province)) {
      return { fields, changed, error: `ไม่รู้จักจังหวัด "${province}"` };
    }
    set('province', province || null);
  }
  if ('description' in body) {
    const description = String(body.description ?? '');
    if (description.length > 4000) return { fields, changed, error: 'คำอธิบายยาวเกิน 4,000 ตัวอักษร' };
    set('description', description.trim() || null);
  }
  if ('status' in body) {
    const status = String(body.status ?? '');
    if (!['pending', 'approved', 'rejected', 'archived'].includes(status)) {
      return { fields, changed, error: `สถานะไม่ถูกต้อง "${status}"` };
    }
    set('status', status);
  }

  return { fields, changed };
}
