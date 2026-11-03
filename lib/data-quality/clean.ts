import type { CleanChange } from './types';

export function cleanProduct(p: any, index: number): { cleaned: any; changes: CleanChange[] } {
  const changes: CleanChange[] = [];
  const out = { ...p };

  const record = (field: string, before: any, after: any, rule: string) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ product_index: index, product_id: p.product_id ?? p.id ?? p.ext, field, before, after, rule });
    }
  };

  // ✅ กฎข้อ 0: ดึง shop_id / product_id จาก ext กลับมาถ้าหายไป
  if (out.ext && out.ext.startsWith('shopee:')) {
    const parts = out.ext.split(':');
    if (parts.length >= 3) {
      if (!out.shop_id) { out.shop_id = parts[1]; record('shop_id', null, out.shop_id, 'healFromExt'); }
      if (!out.product_id) { out.product_id = parts[2]; record('product_id', null, out.product_id, 'healFromExt'); }
    }
  }

  // 1. Name — strip zero-width + HTML + whitespace
  if (typeof out.name === 'string') {
    const before = out.name;
    out.name = cleanString(out.name);
    record('name', before, out.name, 'cleanString');
  }

  // 2. Price — parse string → number
  if (typeof out.price === 'string') {
    const before = out.price;
    out.price = parseNumeric(out.price);
    record('price', before, out.price, 'parseNumeric');
  }

  // 3. Rating — clamp 0..5
  if (out.rating != null) {
    const before = out.rating;
    out.rating = clamp(Number(out.rating), 0, 5);
    record('rating', before, out.rating, 'clamp0-5');
  }

  // 4. Listing age — clamp ≥ 0
  if (out.listing_age_days != null && out.listing_age_days < 0) {
    const before = out.listing_age_days;
    out.listing_age_days = 0;
    record('listing_age_days', before, out.listing_age_days, 'clamp0');
  }

  // 5. Monthly > Historical fix
  if (out.monthly_sold > 0 && out.historical_sold > 0 && out.monthly_sold > out.historical_sold) {
    const before = out.historical_sold;
    out.historical_sold = out.monthly_sold;
    record('historical_sold', before, out.historical_sold, 'fixMonthlyGtHist');
  }

  // 6. Price before discount < price → null
  if (
    out.price_before_discount != null &&
    out.price_before_discount > 0 &&
    out.price_before_discount < out.price
  ) {
    const before = out.price_before_discount;
    out.price_before_discount = null;
    record('price_before_discount', before, null, 'nullIllogicalDiscount');
  }

  // 7. Sync review_count with rating_dist.total
  if (out.rating_dist?.total != null && out.review_count !== out.rating_dist.total) {
    const before = out.review_count;
    out.review_count = out.rating_dist.total;
    record('review_count', before, out.review_count, 'syncWithRatingDist');
  }

  // 8. Boolean coerce (0/1 → false/true)
  for (const f of ['is_ad', 'shopee_verified', 'enriched', 'in_stock']) {
    if (out[f] === 0 || out[f] === 1) {
      const before = out[f];
      out[f] = Boolean(out[f]);
      record(f, before, out[f], 'coerceBoolean');
    }
  }

  // 9. Trim all string fields (except reviews/description)
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && k !== 'reviews' && k !== 'description') {
      const before = out[k];
      out[k] = out[k].trim();
      if (before !== out[k]) record(k, before, out[k], 'trim');
    }
  }

  return { cleaned: out, changes };
}

function cleanString(s: string): string {
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumeric(s: string): number | null {
  if (!s) return null;
  const cleaned = String(s).replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}