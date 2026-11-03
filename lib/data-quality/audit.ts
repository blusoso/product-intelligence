import type { AuditReport, AuditSection, Finding } from './types';

const MISSING_FIELDS = [
  'name', 'price', 'product_id', 'shop_id',
  'rating', 'review_count', 'monthly_sold', 'historical_sold',
];

function isMissing(v: any): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'number' && isNaN(v));
}

function getField(p: any, field: string): any {
  if (field === 'product_id') return p.product_id ?? p.ext?.split(':').pop();
  if (field === 'shop_id') return p.shop_id ?? p.ext?.split(':')[1];
  return p[field];
}

export function auditProducts(products: any[], source = 'products.json'): AuditReport {
  const total = products.length;
  const sections: AuditSection[] = [
    { id: 'completeness', title: 'Data Completeness', icon: '📋', findings: auditCompleteness(products) },
    { id: 'validity',     title: 'Validity',          icon: '✓',  findings: auditValidity(products) },
    { id: 'consistency',  title: 'Cross-field',       icon: '⚖️', findings: auditConsistency(products) },
    { id: 'uniqueness',   title: 'Uniqueness',        icon: '🔍', findings: auditUniqueness(products) },
    { id: 'strings',      title: 'String Quality',    icon: '📝', findings: auditStrings(products) },
    { id: 'distribution', title: 'Distribution',      icon: '📊', findings: auditDistribution(products) },
  ];

  const all = sections.flatMap((s) => s.findings);
  const summary = {
    critical: all.filter((f) => f.severity === 'critical').length,
    warning: all.filter((f) => f.severity === 'warning').length,
    info: all.filter((f) => f.severity === 'info').length,
  };
  const score = Math.max(0, 100 - summary.critical * 15 - summary.warning * 5 - summary.info);

  return {
    generated_at: new Date().toISOString(),
    source,
    total,
    score,
    summary,
    sections,
  };
}

function auditCompleteness(products: any[]): Finding[] {
  const out: Finding[] = [];
  if (!products.length) return out;

  for (const field of MISSING_FIELDS) {
    const missing = products.filter((p) => isMissing(getField(p, field)));
    if (!missing.length) continue;
    const pct = (missing.length / products.length) * 100;
    out.push({
      id: `missing_${field}`,
      severity: pct > 50 ? 'critical' : pct > 10 ? 'warning' : 'info',
      title: `Missing ${field}`,
      description: `${missing.length}/${products.length} (${pct.toFixed(1)}%) missing`,
      count: missing.length,
      samples: missing.slice(0, 3).map((p) => ({
        id: p.id ?? p.product_id,
        name: String(p.name ?? '').slice(0, 40),
      })),
      auto_fixable: false,
    });
  }
  return out;
}

function auditValidity(products: any[]): Finding[] {
  const out: Finding[] = [];

  const zeroPrice = products.filter((p) => !p.price || Number(p.price) <= 0);
  if (zeroPrice.length) {
    out.push({
      id: 'price_zero',
      severity: zeroPrice.length > products.length * 0.1 ? 'critical' : 'warning',
      title: 'Invalid price (0 or negative)',
      description: `${zeroPrice.length} records have price ≤ 0`,
      count: zeroPrice.length,
      samples: zeroPrice.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, price: p.price })),
      auto_fixable: false,
    });
  }

  const badRating = products.filter(
    (p) => p.rating != null && (Number(p.rating) < 0 || Number(p.rating) > 5),
  );
  if (badRating.length) {
    out.push({
      id: 'rating_out_of_range',
      severity: 'warning',
      title: 'Rating outside 0–5 range',
      description: `${badRating.length} records have invalid rating`,
      count: badRating.length,
      samples: badRating.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, rating: p.rating })),
      auto_fixable: true,
    });
  }

  const negAge = products.filter((p) => p.listing_age_days != null && p.listing_age_days < 0);
  if (negAge.length) {
    out.push({
      id: 'negative_age',
      severity: 'warning',
      title: 'Negative listing age',
      description: `${negAge.length} records have negative age`,
      count: negAge.length,
      samples: negAge.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, age: p.listing_age_days })),
      auto_fixable: true,
    });
  }

  const noId = products.filter((p) => isMissing(getField(p, 'product_id')));
  if (noId.length) {
    out.push({
      id: 'no_product_id',
      severity: 'critical',
      title: 'Missing product_id',
      description: `${noId.length} records cannot be deduplicated`,
      count: noId.length,
      samples: noId.slice(0, 3).map((p) => ({ name: String(p.name ?? '').slice(0, 40) })),
      auto_fixable: false,
    });
  }
  return out;
}

function auditConsistency(products: any[]): Finding[] {
  const out: Finding[] = [];

  const monthlyGt = products.filter(
    (p) => p.monthly_sold > 0 && p.historical_sold > 0 && p.monthly_sold > p.historical_sold,
  );
  if (monthlyGt.length) {
    out.push({
      id: 'monthly_gt_historical',
      severity: 'warning',
      title: 'Monthly sold > Historical sold',
      description: `${monthlyGt.length} records have inconsistent sold counts`,
      count: monthlyGt.length,
      samples: monthlyGt.slice(0, 3).map((p) => ({
        id: p.id ?? p.product_id,
        monthly: p.monthly_sold,
        hist: p.historical_sold,
      })),
      auto_fixable: true,
    });
  }

  const discountWrong = products.filter(
    (p) => p.price_before_discount != null && p.price_before_discount > 0 && p.price_before_discount < p.price,
  );
  if (discountWrong.length) {
    out.push({
      id: 'price_before_discount_wrong',
      severity: 'info',
      title: 'Price before discount < current price',
      description: `${discountWrong.length} records have illogical discount`,
      count: discountWrong.length,
      samples: discountWrong.slice(0, 3).map((p) => ({
        id: p.id ?? p.product_id,
        price: p.price,
        before: p.price_before_discount,
      })),
      auto_fixable: true,
    });
  }

  const mismatch = products.filter(
    (p) => p.review_count != null && p.rating_dist?.total != null && p.review_count !== p.rating_dist.total,
  );
  if (mismatch.length) {
    out.push({
      id: 'review_count_mismatch',
      severity: 'info',
      title: 'review_count ≠ rating_dist.total',
      description: `${mismatch.length} records have mismatched counts`,
      count: mismatch.length,
      samples: mismatch.slice(0, 3).map((p) => ({
        id: p.id ?? p.product_id,
        review: p.review_count,
        dist: p.rating_dist.total,
      })),
      auto_fixable: true,
    });
  }
  return out;
}

function auditUniqueness(products: any[]): Finding[] {
  const out: Finding[] = [];

  const byId: Record<string, number[]> = {};
  products.forEach((p, i) => {
    const id = String(getField(p, 'product_id') ?? '');
    if (!id) return;
    (byId[id] ||= []).push(i);
  });
  const dupIds = Object.entries(byId).filter(([, idxs]) => idxs.length > 1);
  if (dupIds.length) {
    out.push({
      id: 'duplicates_product_id',
      severity: 'critical',
      title: 'Duplicate product_id',
      description: `${dupIds.length} product_ids appear multiple times`,
      count: dupIds.length,
      samples: dupIds.slice(0, 3).map(([id, idxs]) => ({ product_id: id, count: idxs.length })),
      auto_fixable: true,
    });
  }

  const byName: Record<string, number> = {};
  products.forEach((p) => {
    const n = String(p.name ?? '').trim().toLowerCase();
    if (!n) return;
    byName[n] = (byName[n] || 0) + 1;
  });
  const dupNames = Object.entries(byName).filter(([, c]) => c > 1);
  if (dupNames.length) {
    out.push({
      id: 'duplicates_name',
      severity: 'info',
      title: 'Duplicate name (different IDs)',
      description: `${dupNames.length} names appear multiple times (may be legit)`,
      count: dupNames.length,
      samples: dupNames.slice(0, 3).map(([n, c]) => ({ name: n.slice(0, 50), count: c })),
      auto_fixable: false,
    });
  }
  return out;
}

function auditStrings(products: any[]): Finding[] {
  const out: Finding[] = [];
  const nameOf = (p: any) => String(p.name ?? '');

  const hasHtml = products.filter((p) => /<[^>]+>/.test(nameOf(p)));
  if (hasHtml.length) {
    out.push({
      id: 'html_in_name',
      severity: 'warning',
      title: 'HTML tags in name',
      description: `${hasHtml.length} names contain HTML`,
      count: hasHtml.length,
      samples: hasHtml.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, name: nameOf(p).slice(0, 60) })),
      auto_fixable: true,
    });
  }

  const hasZW = products.filter((p) => /[\u200B-\u200D\uFEFF]/.test(nameOf(p)));
  if (hasZW.length) {
    out.push({
      id: 'zero_width',
      severity: 'warning',
      title: 'Zero-width characters in name',
      description: `${hasZW.length} names contain hidden chars`,
      count: hasZW.length,
      samples: hasZW.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, name: nameOf(p).slice(0, 60) })),
      auto_fixable: true,
    });
  }

  const emojiHeavy = products.filter((p) => {
    const m = nameOf(p).match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu);
    return m && m.length > 3;
  });
  if (emojiHeavy.length) {
    out.push({
      id: 'emoji_heavy',
      severity: 'info',
      title: 'Excessive emoji (>3)',
      description: `${emojiHeavy.length} names have many emojis`,
      count: emojiHeavy.length,
      samples: emojiHeavy.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, name: nameOf(p).slice(0, 60) })),
      auto_fixable: true,
    });
  }

  const tooLong = products.filter((p) => nameOf(p).length > 200);
  if (tooLong.length) {
    out.push({
      id: 'name_too_long',
      severity: 'warning',
      title: 'Name > 200 chars',
      description: `${tooLong.length} names are longer than 200 chars`,
      count: tooLong.length,
      samples: tooLong.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id, length: nameOf(p).length })),
      auto_fixable: true,
    });
  }

  const empty = products.filter((p) => !nameOf(p).trim());
  if (empty.length) {
    out.push({
      id: 'empty_name',
      severity: 'critical',
      title: 'Empty product name',
      description: `${empty.length} records have empty names`,
      count: empty.length,
      samples: empty.slice(0, 3).map((p) => ({ id: p.id ?? p.product_id })),
      auto_fixable: false,
    });
  }
  return out;
}

function auditDistribution(products: any[]): Finding[] {
  const out: Finding[] = [];
  if (!products.length) return out;

  const prices = products
    .map((p) => Number(p.price))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  if (prices.length) {
    const p50 = prices[Math.floor(prices.length * 0.5)];
    const p99 = prices[Math.floor(prices.length * 0.99)];
    const outliers = prices.filter((x) => x > p99 * 5);
    if (outliers.length) {
      out.push({
        id: 'price_outliers',
        severity: 'info',
        title: 'Price outliers',
        description: `${outliers.length} prices are >5x P99 (median ${p50}, P99 ${p99})`,
        count: outliers.length,
        samples: outliers.slice(0, 5).map((p) => ({ price: p })),
        auto_fixable: false,
      });
    }
  }

  const cats = new Set(products.map((p) => p.cat).filter(Boolean));
  if (cats.size === 1 && products.length > 10) {
    out.push({
      id: 'single_category',
      severity: 'info',
      title: 'All products in one category',
      description: `All ${products.length} products are "${[...cats][0]}" — check inference`,
      count: products.length,
      samples: [],
      auto_fixable: false,
    });
  }
  return out;
}