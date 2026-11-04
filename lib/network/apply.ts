import type { NormalizedProduct, SyncMode } from './types';

export interface SyncResult {
  attempted: number;
  updated: number;
  failed: number;
  skipped: boolean;
  mode: SyncMode | null;
  note?: string;
  hint?: string;
  errors: { ext: string; error: string }[];
}

const round = (n: number, digits = 3) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function coreFields(p: NormalizedProduct): Record<string, any> {
  const fields: Record<string, any> = {
    name: p.name,
    price: p.price,
    price_before_discount: p.price_before_discount,
    discount_pct: p.discount_pct,
    monthly_sold: p.monthly_sold,
    historical_sold: p.historical_sold,
    rating: p.rating,
    review_count: p.review_count,
    trust_score: p.trust_score,
    listing_age_days: p.listing_age_days,
    in_stock: p.in_stock,
  };
  if (p.image) fields.image = p.image;
  if (p.description) fields.description = p.description.slice(0, 4000);
  return fields;
}

/** คอลัมน์จาก migration 20261103120000 + 20261103130000 + 20261103132500 + ai_enrichment */
function normalizedFields(p: NormalizedProduct): Record<string, any> {
  return {
    brand: p.brand,
    product_type: p.product_type,
    province: p.province !== 'ไม่ระบุ' ? p.province : null,
    region: p.region !== 'ไม่ระบุ' ? p.region : null,
    category_confidence: round(p.category_confidence),
    quality_score: Math.round(p.quality_score),
    quality_flags: p.quality_flags ?? [],
    network_node_key: p.node_key,
    currency: p.currency ?? 'THB',
    width_cm: p.width_cm,
    depth_cm: p.depth_cm,
    height_cm: p.height_cm,
    size_label: p.size_label,
    canonical_id: p.canonical_id,
    canonical_confidence: p.canonical_id ? round(p.canonical_confidence) : null,
    listing_count: p.listing_count ?? 1,
    enrichment: p.enrichment,
    // เขียนเฉพาะเมื่อมีค่า — ไม่ล้าง ai_enrichment เดิมด้วย null
    ...(p.ai ? { ai_enrichment: p.ai } : {}),
  };
}

function fieldsFor(p: NormalizedProduct, mode: SyncMode): Record<string, any> {
  if (mode === 'core') return coreFields(p);
  if (mode === 'normalized') return normalizedFields(p);
  return { ...coreFields(p), ...normalizedFields(p) };
}

const MISSING_COLUMN = /column .* does not exist|could not find the '.*' column|PGRST204/i;

/**
 * เขียนค่าที่ normalize แล้วกลับไปที่ตาราง products โดยใช้ ext เป็นกุญแจ
 * - core: ฟิลด์หลักที่เดิมมีอยู่แล้ว
 * - normalized: คอลัมน์จาก migration network_graph (brand/type/จังหวัด/คะแนน)
 * - both: รวมกัน
 * ไม่แตะ _raw, status, sku หรือข้อมูลแอดมิน
 */
export async function applyCoreFields(
  products: NormalizedProduct[],
  source: 'db' | 'file',
  mode: SyncMode = 'core',
): Promise<SyncResult> {
  if (source !== 'db') {
    return {
      attempted: products.length,
      updated: 0,
      failed: 0,
      skipped: true,
      mode,
      note: 'source=file — ไม่มีฐานข้อมูลให้ sync (เลือก Supabase ก่อน)',
      errors: [],
    };
  }

  const { supabase } = await import('@/lib/supabase');
  const result: SyncResult = {
    attempted: products.length,
    updated: 0,
    failed: 0,
    skipped: false,
    mode,
    errors: [],
  };

  // ── คีย์ที่ admin แก้เอง → pipeline ต้องไม่เขียนทับ ──
  // (products.manual_edits = { name: {...}, brand: {...} })
  const locked = new Map<string, Set<string>>();
  const exts = [...new Set(products.map((p) => p.ext).filter(Boolean))];
  for (let i = 0; i < exts.length; i += 100) {
    const { data } = await supabase
      .from('products')
      .select('ext,manual_edits')
      .in('ext', exts.slice(i, i + 100))
      .not('manual_edits', 'is', null);
    for (const row of data ?? []) {
      const keys = Object.keys((row as any).manual_edits ?? {});
      if (keys.length) locked.set(String((row as any).ext), new Set(keys));
    }
  }
  const without = (fields: Record<string, any>, ext: string) => {
    const lk = locked.get(ext);
    if (!lk) return fields;
    const out = { ...fields };
    for (const key of lk) delete out[key];
    return out;
  };

  // ยิงทีละ 3 คำขอ (พอประมาณ ไม่ให้ rate-limit และเร็วกว่าไล่ทีละแถว)
  const CONCURRENCY = 3;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const chunk = products.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (p) => {
        if (!p.ext) {
          return { p, error: null as any, missing: false, noExt: true };
        }
        const fields = without(fieldsFor(p, mode), p.ext);
        if (Object.keys(fields).length === 0) {
          return { p, error: null as any, missing: false, noExt: false, skipped: true };
        }
        const { error } = await supabase.from('products').update(fields).eq('ext', p.ext);
        return {
          p,
          error,
          missing: Boolean(error && (MISSING_COLUMN.test(error.message) || error.code === 'PGRST204')),
          noExt: false,
          skipped: false,
        };
      }),
    );

    for (const r of results) {
      if (r.noExt) {
        result.failed++;
        result.errors.push({ ext: '(missing)', error: 'no ext' });
        continue;
      }
      if (r.skipped) {
        result.updated++;
        continue;
      }
      if (r.error) {
        // คอลัมน์ยังไม่มี = migration ยังไม่ถูก apply → หยุดทันที ไม่เขียนครึ่ง ๆ กลาง ๆ
        if (r.missing) {
          return {
            ...result,
            skipped: true,
            hint: 'ต้อง apply migration ใน supabase/migrations ก่อน (หรือเลือก sync แบบ core)',
            errors: [{ ext: r.p.ext, error: r.error.message }],
          };
        }
        result.failed++;
        if (result.errors.length < 20) result.errors.push({ ext: r.p.ext, error: r.error.message });
      } else {
        result.updated++;
      }
    }
  }
  return result;
}
