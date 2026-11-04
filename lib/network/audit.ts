import type {
  AuditReport,
  AuditSection,
  CanonicalSummary,
  DimensionScore,
  Finding,
  Graph,
  NormalizedProduct,
  Severity,
} from './types';
import {
  cleanProductName,
  looksMojibake,
  median,
  nameKey,
  parseNumber,
  quantile,
  ratio,
} from './text';
import { detectBrand, detectCategory } from './taxonomy';
import { detectAllConflicts } from './conflicts';
import { VISUAL_ATTR_IDS } from './vocab';
import { enrichmentCoverage } from './enrich';

const WEIGHTS: Record<string, number> = {
  identity: 20,
  completeness: 15,
  validity: 15,
  consistency: 10,
  text: 10,
  uniqueness: 10,
  network: 20,
};

const SEVERITY_FACTOR: Record<Severity, number> = {
  critical: 1,
  warning: 0.6,
  info: 0.2,
};

const SEVERITY_CAP: Record<Severity, number> = {
  critical: 45,
  warning: 22,
  info: 6,
};

function finding(
  id: string,
  severity: Severity,
  title: string,
  description: string,
  count: number,
  total: number,
  samples: any[] = [],
  autoFixable = false,
  fix?: string,
): Finding {
  return {
    id,
    severity,
    title,
    description,
    count,
    ratio: total > 0 ? count / total : 0,
    samples: samples.slice(0, 5),
    auto_fixable: autoFixable,
    ...(fix ? { fix } : {}),
  };
}

function severityFor(pct: number): Severity {
  if (pct > 0.25) return 'critical';
  if (pct > 0.05) return 'warning';
  return 'info';
}

function section(id: string, title: string, icon: string, findings: Finding[]): AuditSection {
  const totalPenalty = findings.reduce((sum, f) => {
    const covered = f.ratio ?? 0;
    const raw = covered * 100 * SEVERITY_FACTOR[f.severity];
    return sum + Math.min(SEVERITY_CAP[f.severity], raw);
  }, 0);
  return {
    id,
    title,
    icon,
    findings,
    score: Math.max(0, Math.round(100 - totalPenalty)),
  };
}

function gradeFor(score: number): AuditReport['grade'] {
  if (score >= 90) return 'A';
  if (score >= 78) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function summarize(sections: AuditSection[]): AuditReport['summary'] {
  const all = sections.flatMap((s) => s.findings);
  return {
    critical: all.filter((f) => f.severity === 'critical').length,
    warning: all.filter((f) => f.severity === 'warning').length,
    info: all.filter((f) => f.severity === 'info').length,
  };
}

function buildReport(
  source: string,
  total: number,
  sections: AuditSection[],
  readiness: number,
): AuditReport {
  const dims: DimensionScore[] = sections.map((s) => ({
    id: s.id,
    label: s.title,
    // Network readiness มาจาก coverage/connectivity ของ graph โดยตรง
    // (findings ใน section นี้เป็น "คำเตือนเชิงโครงสร้าง" ไม่ใช่ penalty)
    score: s.id === 'network' ? Math.round(readiness) : s.score,
    weight: WEIGHTS[s.id] ?? 0,
  }));
  for (const s of sections) {
    if (s.id === 'network') s.score = Math.round(readiness);
  }
  const weightSum = dims.reduce((n, d) => n + d.weight, 0) || 1;
  const score = Math.round(dims.reduce((n, d) => n + d.score * d.weight, 0) / weightSum);
  return {
    generated_at: new Date().toISOString(),
    source,
    total,
    score,
    grade: gradeFor(score),
    readiness: Math.round(readiness),
    summary: summarize(sections),
    dimensions: dims,
    sections,
  };
}

function getField(p: any, field: string): any {
  if (field === 'product_id') return p.product_id ?? p.ext?.split(':').pop();
  if (field === 'shop_id') return p.shop_id ?? p.ext?.split(':')[1];
  return p[field];
}

function isMissing(v: any): boolean {
  return v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

/* ═══════════════════════════════════════════════════════════════
   PASS 1 — ตรวจข้อมูลดิบ (ก่อน normalize)
   ═══════════════════════════════════════════════════════════════ */
export function auditRawProducts(products: any[], source = 'raw'): AuditReport {
  const total = products.length;
  const nameOf = (p: any) => String(p.name ?? p.product_name ?? '');
  const priceOf = (p: any) => parseNumber(p.price) ?? 0;

  // ── identity ────────────────────────────────────────────────
  const identity: Finding[] = [];
  const noPid = products.filter((p) => !String(getField(p, 'product_id') ?? '').trim());
  if (noPid.length) {
    identity.push(finding('missing_product_id', 'critical', 'ไม่มี product_id', `${noPid.length}/${total} records ไม่มีรหัสสินค้า — dedupe/graph ไม่ได้`, noPid.length, total, noPid.slice(0, 3).map((p) => ({ name: nameOf(p).slice(0, 40) }))));
  }
  const noShop = products.filter((p) => !String(getField(p, 'shop_id') ?? '').trim());
  if (noShop.length) {
    identity.push(finding('missing_shop_id', 'critical', 'ไม่มี shop_id', `${noShop.length}/${total} records ไม่มีรหัสร้าน — เชื่อม product→shop ไม่ได้`, noShop.length, total, noShop.slice(0, 3).map((p) => ({ name: nameOf(p).slice(0, 40) }))));
  }
  const extMismatch = products.filter((p) => {
    const parts = String(p.ext ?? '').split(':');
    if (parts.length < 3) return false;
    return String(p.shop_id ?? '') !== parts[1] || String(p.product_id ?? '') !== parts[2];
  });
  if (extMismatch.length) {
    identity.push(finding('ext_mismatch', 'warning', 'ext ไม่ตรงกับ shop/product id', `${extMismatch.length} records มี ext ไม่สอดคล้อง — อาจเกิดจาก merge ข้ามรอบ`, extMismatch.length, total, extMismatch.slice(0, 3).map((p) => ({ ext: p.ext, shop_id: p.shop_id, product_id: p.product_id })), true, 'rebuild-ext'));
  }

  const byPid = new Map<string, number>();
  products.forEach((p) => {
    const id = String(getField(p, 'product_id') ?? '');
    if (id) byPid.set(id, (byPid.get(id) ?? 0) + 1);
  });
  const dupPid = [...byPid.entries()].filter(([, n]) => n > 1);
  if (dupPid.length) {
    identity.push(finding('duplicate_product_id', 'critical', 'product_id ซ้ำ', `${dupPid.length} รหัสสินค้าปรากฏมากกว่า 1 ครั้ง (${dupPid.reduce((n, [, c]) => n + c - 1, 0)} records เกิน) — graph จะมี node ผี`, dupPid.length, total, dupPid.slice(0, 3).map(([id, c]) => ({ product_id: id, count: c })), true, 'merge-duplicates'));
  }

  const keyName = new Map<string, number>();
  products.forEach((p) => {
    const k = `${getField(p, 'shop_id')}|${nameKey(cleanProductName(nameOf(p)).text)}`;
    if (k.split('|')[1]) keyName.set(k, (keyName.get(k) ?? 0) + 1);
  });
  const dupName = [...keyName.entries()].filter(([, n]) => n > 1);
  if (dupName.length) {
    identity.push(finding('duplicate_name_shop', 'warning', 'ชื่อซ้ำในร้านเดียวกัน', `${dupName.length} กลุ่มชื่อซ้ำหลังทำความสะอาด — อาจเป็นสินค้าคนละ listing`, dupName.length, total, dupName.slice(0, 3).map(([k, c]) => ({ key: k.slice(0, 70), count: c }))));
  }

  // ── completeness ───────────────────────────────────────────
  const completeness: Finding[] = [];
  const fields: [string, string][] = [
    ['name', 'ชื่อสินค้า'],
    ['price', 'ราคา'],
    ['rating', 'คะแนน'],
    ['review_count', 'จำนวนรีวิว'],
    ['monthly_sold', 'ยอดขาย/เดือน'],
    ['historical_sold', 'ยอดขายสะสม'],
    ['location', 'ที่ตั้งร้าน'],
    ['specs', 'สเปกสินค้า'],
    ['image', 'รูปภาพ'],
  ];
  for (const [field, label] of fields) {
    const missing = products.filter((p) => {
      if (field === 'specs') return !(Array.isArray(p.specs) && p.specs.length);
      if (field === 'image') return !(p.image || p.cover_image || (Array.isArray(p.images_all) && p.images_all.length));
      return isMissing(p[field]) || (field === 'review_count' && Number(p[field]) === 0);
    });
    if (!missing.length) continue;
    const pct = missing.length / total;
    const severity: Severity =
      field === 'image' ? 'info' : field === 'specs' ? 'warning' : severityFor(pct);
    completeness.push(finding(`missing_${field}`, severity, `ขาด ${label}`, `${missing.length}/${total} (${(pct * 100).toFixed(1)}%) ไม่มีข้อมูล`, missing.length, total, missing.slice(0, 3).map((p) => ({ id: p.product_id ?? p.ext, name: nameOf(p).slice(0, 40) })), ['specs', 'image', 'location'].includes(field), field === 'specs' ? 'derive-specs' : undefined));
  }

  const noBrandRaw = products.filter((p) => {
    const specs = Array.isArray(p.specs) ? p.specs : [];
    return !detectBrand(nameOf(p), specs, String(p.shop_name ?? '')).brand;
  });
  if (noBrandRaw.length) {
    completeness.push(finding('missing_brand', 'warning', 'ขาดแบรนด์', `${noBrandRaw.length}/${total} (${((noBrandRaw.length / total) * 100).toFixed(1)}%) ไม่พบแบรนด์ในชื่อ/สเปก/ร้าน`, noBrandRaw.length, total, noBrandRaw.slice(0, 3).map((p) => ({ id: p.product_id, name: nameOf(p).slice(0, 40) })), false, 'infer-brand'));
  }

  // ── validity ───────────────────────────────────────────────
  const validity: Finding[] = [];
  const badPrice = products.filter((p) => priceOf(p) <= 0);
  if (badPrice.length) {
    validity.push(finding('price_invalid', 'critical', 'ราคาไม่ถูกต้อง (≤ 0)', `${badPrice.length} records ราคาเป็น 0/ติดลบ/แปลงไม่ได้`, badPrice.length, total, badPrice.slice(0, 3).map((p) => ({ id: p.product_id, price: p.price }))));
  }
  const extremePrice = products.filter((p) => priceOf(p) > 1_000_000);
  if (extremePrice.length) {
    validity.push(finding('price_extreme', 'warning', 'ราคาสูงผิดปกติ (> 1,000,000)', `${extremePrice.length} records อาจเป็นหน่วยสตางค์หรือ parse ผิด`, extremePrice.length, total, extremePrice.slice(0, 3).map((p) => ({ id: p.product_id, price: p.price }))));
  }
  const badRating = products.filter((p) => {
    const r = parseNumber(p.rating);
    return r != null && (r < 0 || r > 5);
  });
  if (badRating.length) {
    validity.push(finding('rating_out_of_range', 'warning', 'คะแนนนอกช่วง 0–5', `${badRating.length} records`, badRating.length, total, badRating.slice(0, 3).map((p) => ({ id: p.product_id, rating: p.rating })), true, 'clamp-rating'));
  }
  const negCounts = products.filter((p) => (parseNumber(p.review_count) ?? 0) < 0 || (parseNumber(p.monthly_sold) ?? 0) < 0 || (parseNumber(p.historical_sold) ?? 0) < 0);
  if (negCounts.length) {
    validity.push(finding('negative_counts', 'warning', 'ตัวเลขติดลบ', `${negCounts.length} records มี review/sold ติดลบ`, negCounts.length, total, negCounts.slice(0, 3).map((p) => ({ id: p.product_id })), true, 'clamp-negative'));
  }
  const badAge = products.filter((p) => (parseNumber(p.listing_age_days) ?? 0) < 0);
  if (badAge.length) {
    validity.push(finding('negative_age', 'warning', 'อายุ listing ติดลบ', `${badAge.length} records`, badAge.length, total, badAge.slice(0, 3).map((p) => ({ id: p.product_id, age: p.listing_age_days })), true, 'clamp-age'));
  }
  const badUrl = products.filter((p) => p.url && !/^https?:\/\//i.test(String(p.url)));
  if (badUrl.length) {
    validity.push(finding('invalid_url', 'info', 'URL ไม่ขึ้นต้นด้วย http', `${badUrl.length} records`, badUrl.length, total, badUrl.slice(0, 3).map((p) => ({ id: p.product_id, url: p.url })), true, 'fix-url'));
  }
  const badTrust = products.filter((p) => {
    const t = parseNumber(p.trust_score);
    return t != null && (t < 0 || t > 100);
  });
  if (badTrust.length) {
    validity.push(finding('trust_out_of_range', 'info', 'trust_score นอกช่วง 0–100', `${badTrust.length} records`, badTrust.length, total, badTrust.slice(0, 3).map((p) => ({ id: p.product_id, trust: p.trust_score })), true, 'clamp-trust'));
  }

  // ── consistency ────────────────────────────────────────────
  const consistency: Finding[] = [];
  const soldConflict = products.filter((p) => {
    const m = parseNumber(p.monthly_sold) ?? 0;
    const h = parseNumber(p.historical_sold) ?? 0;
    return m > 0 && h > 0 && m > h;
  });
  if (soldConflict.length) {
    consistency.push(finding('monthly_gt_historical', 'warning', 'ยอดขายเดือน > ยอดสะสม', `${soldConflict.length} records ขัดแย้งกัน — ต้อง reconcile ก่อนสร้างน้ำหนัก edge`, soldConflict.length, total, soldConflict.slice(0, 3).map((p) => ({ id: p.product_id, monthly: p.monthly_sold, historical: p.historical_sold })), true, 'reconcile-sold'));
  }
  const badDiscount = products.filter((p) => {
    const before = parseNumber(p.price_before_discount);
    const price = parseNumber(p.price) ?? 0;
    return before != null && before > 0 && before <= price;
  });
  if (badDiscount.length) {
    consistency.push(finding('price_before_lte_price', 'info', 'ราคาก่อนลด ≤ ราคาปัจจุบัน', `${badDiscount.length} records`, badDiscount.length, total, badDiscount.slice(0, 3).map((p) => ({ id: p.product_id, price: p.price, before: p.price_before_discount })), true, 'drop-illogical-discount'));
  }
  const distMismatch = products.filter((p) => {
    const rc = parseNumber(p.review_count) ?? 0;
    const totalDist = parseNumber(p.rating_dist?.total) ?? 0;
    return totalDist > 0 && rc !== totalDist;
  });
  if (distMismatch.length) {
    consistency.push(finding('review_dist_mismatch', 'info', 'review_count ≠ rating_dist.total', `${distMismatch.length} records`, distMismatch.length, total, distMismatch.slice(0, 3).map((p) => ({ id: p.product_id, reviews: p.review_count, dist: p.rating_dist?.total })), true, 'prefer-rating-dist'));
  }
  const legacyCategory = products.filter((p) => p.cat && p.cat !== 'Other').length;
  if (legacyCategory === 0) {
    consistency.push(finding('no_category_signal', 'critical', 'ไม่มีหมวดหมู่จากต้นทาง', `ทั้ง ${total} records ไม่มี cat ที่ใช้ได้ (ส่วนใหญ่เป็น "Other") — ต้องอนุมานจากชื่อ/สเปก`, total, total, [], true, 'infer-category'));
  }
  const rawLocation = products.filter((p) => /^จังหวัด/.test(String(p.location ?? '')));
  if (rawLocation.length) {
    consistency.push(finding('location_not_normalized', 'info', 'ที่ตั้งยังไม่ normalize', `${rawLocation.length} records ขึ้นต้นด้วย "จังหวัด" — ควรแปลงเป็นชื่อจังหวัดมาตรฐาน`, rawLocation.length, total, rawLocation.slice(0, 3).map((p) => ({ id: p.product_id, location: p.location })), true, 'normalize-province'));
  }

  // ── text ───────────────────────────────────────────────────
  const text: Finding[] = [];
  const mojibake = products.filter((p) => looksMojibake(nameOf(p)));
  if (mojibake.length) {
    text.push(finding('mojibake', 'critical', 'ตัวอักษรเพี้ยน (mojibake)', `${mojibake.length} ชื่อมีรูปแบบ encoding ผิด — ต้องซ่อมก่อนจับคู่`, mojibake.length, total, mojibake.slice(0, 3).map((p) => ({ id: p.product_id, name: nameOf(p).slice(0, 60) })), true, 'repair-mojibake'));
  }
  const html = products.filter((p) => /<[^>]+>/.test(nameOf(p)));
  if (html.length) {
    text.push(finding('html_in_name', 'warning', 'มี HTML ในชื่อ', `${html.length} ชื่อ`, html.length, total, html.slice(0, 3).map((p) => ({ id: p.product_id, name: nameOf(p).slice(0, 60) })), true, 'strip-html'));
  }
  const zeroWidth = products.filter((p) => /[\u200B-\u200D\uFEFF]/.test(nameOf(p)));
  if (zeroWidth.length) {
    text.push(finding('zero_width', 'warning', 'มีอักขระซ่อน (zero-width)', `${zeroWidth.length} ชื่อ`, zeroWidth.length, total, zeroWidth.slice(0, 3).map((p) => ({ id: p.product_id })), true, 'strip-zero-width'));
  }
  const emoji = products.filter((p) => cleanProductName(nameOf(p)).emoji > 3);
  if (emoji.length) {
    text.push(finding('emoji_heavy', 'info', 'emoji มากเกินไป (>3)', `${emoji.length} ชื่อ`, emoji.length, total, emoji.slice(0, 3).map((p) => ({ id: p.product_id, name: nameOf(p).slice(0, 50) })), true, 'strip-emoji'));
  }
  const longName = products.filter((p) => nameOf(p).length > 200);
  if (longName.length) {
    text.push(finding('name_too_long', 'warning', 'ชื่อยาวเกิน 200 ตัวอักษร', `${longName.length} ชื่อ`, longName.length, total, longName.slice(0, 3).map((p) => ({ id: p.product_id, length: nameOf(p).length })), true, 'truncate-name'));
  }
  const emptyName = products.filter((p) => !nameOf(p).trim());
  if (emptyName.length) {
    text.push(finding('empty_name', 'critical', 'ชื่อว่าง', `${emptyName.length} records`, emptyName.length, total, emptyName.slice(0, 3).map((p) => ({ id: p.product_id }))));
  }

  // ── uniqueness / distribution ──────────────────────────────
  const uniqueness: Finding[] = [];
  const byExt = new Map<string, number>();
  products.forEach((p) => {
    if (p.ext) byExt.set(String(p.ext), (byExt.get(String(p.ext)) ?? 0) + 1);
  });
  const dupExt = [...byExt.entries()].filter(([, n]) => n > 1);
  if (dupExt.length) {
    uniqueness.push(finding('duplicate_ext', 'warning', 'ext ซ้ำ', `${dupExt.length} ext ปรากฏหลายครั้ง (ข้อมูลจากหลายรอบ scrape)`, dupExt.length, total, dupExt.slice(0, 3).map(([ext, count]) => ({ ext, count })), true, 'merge-duplicates'));
  }
  const shops = new Map<string, number>();
  products.forEach((p) => {
    const s = String(getField(p, 'shop_id') ?? '');
    if (s) shops.set(s, (shops.get(s) ?? 0) + 1);
  });
  const singleProductShops = [...shops.values()].filter((n) => n === 1).length;
  const networkFindings: Finding[] = [];
  if (shops.size && singleProductShops / shops.size > 0.5) {
    networkFindings.push(finding('shop_fanout_low', 'warning', 'ร้านส่วนใหญ่มีสินค้าเดียว', `${singleProductShops}/${shops.size} ร้านมีสินค้า 1 ชิ้น — shop hub อ่อน`, singleProductShops, shops.size, [], false));
  }

  const distribution: Finding[] = [];
  const prices = products.map(priceOf).filter((n) => n > 0);
  if (prices.length > 10) {
    const p99 = quantile(prices, 0.99);
    const med = median(prices);
    const outliers = prices.filter((x) => x > p99 * 5);
    if (outliers.length) {
      distribution.push(finding('price_outliers', 'info', 'ราคา outlier', `${outliers.length} ราคา > 5×P99 (median ${med.toFixed(0)}, P99 ${p99.toFixed(0)})`, outliers.length, total, outliers.slice(0, 5).map((p) => ({ price: p })), false));
    }
  }

  const sections = [
    section('identity', 'Identity & Integrity', '🆔', identity),
    section('completeness', 'Completeness', '📋', completeness),
    section('validity', 'Validity', '✓', validity),
    section('consistency', 'Cross-field Consistency', '⚖️', consistency),
    section('text', 'Text Quality', '📝', text),
    section('uniqueness', 'Uniqueness & Distribution', '🔍', [...uniqueness, ...distribution]),
    section('network', 'Network Readiness', '🕸️', networkFindings),
  ];

  const readiness = estimateReadiness(products.map((p) => ({
    product_id: String(getField(p, 'product_id') ?? ''),
    shop_id: String(getField(p, 'shop_id') ?? ''),
    category: '',
    product_type: '',
    brand: null,
    province: '',
  })), products);

  return { ...buildReport(source, total, sections, readiness), projection: undefined };
}

/* ═══════════════════════════════════════════════════════════════
   PASS 2 — ตรวจข้อมูลหลัง normalize + graph metrics
   ═══════════════════════════════════════════════════════════════ */
export function auditNormalizedProducts(
  products: NormalizedProduct[],
  source = 'normalized',
  graph?: Graph,
  canonical?: CanonicalSummary,
): AuditReport {
  const total = products.length;
  const byFlag = (flag: string) => products.filter((p) => p.quality_flags.includes(flag));

  // identity
  const identity: Finding[] = [];
  const noPid = products.filter((p) => !p.product_id);
  if (noPid.length) identity.push(finding('missing_product_id', 'critical', 'ไม่มี product_id', `${noPid.length} records`, noPid.length, total, noPid.slice(0, 3).map((p) => ({ name: p.name.slice(0, 40) }))));
  const noShop = products.filter((p) => !p.shop_id);
  if (noShop.length) identity.push(finding('missing_shop_id', 'critical', 'ไม่มี shop_id', `${noShop.length} records`, noShop.length, total, noShop.slice(0, 3).map((p) => ({ name: p.name.slice(0, 40) }))));
  const healed = byFlag('identity_healed');
  if (healed.length) identity.push(finding('identity_healed', 'info', 'กู้ identity จาก ext', `${healed.length} records ถูกเติม shop_id/product_id จาก ext`, healed.length, total, healed.slice(0, 3).map((p) => ({ id: p.product_id })), true, 'heal-identity'));
  const noPlatform = byFlag('platform_missing');
  if (noPlatform.length) identity.push(finding('platform_missing', 'info', 'ไม่ระบุแพลตฟอร์ม', `${noPlatform.length} records ไม่มี plat — ใช้ shopee เป็นค่าเริ่มต้น`, noPlatform.length, total, noPlatform.slice(0, 3).map((p) => ({ id: p.product_id })), false));

  // completeness
  const completeness: Finding[] = [];
  const keyAttrs: { key: keyof NormalizedProduct; label: string; flag?: string }[] = [
    { key: 'brand', label: 'แบรนด์', flag: 'brand_missing' },
    { key: 'image', label: 'รูปภาพ', flag: 'missing_image' },
    { key: 'province', label: 'จังหวัด' },
  ];
  for (const attr of keyAttrs) {
    const missing = products.filter((p) => {
      const v = p[attr.key];
      return v == null || v === '' || v === 'ไม่ระบุ';
    });
    if (!missing.length) continue;
    const pct = missing.length / total;
    const severity: Severity =
      (attr.key as string) === 'image' ? 'info' : (attr.key as string) === 'brand' ? 'warning' : severityFor(pct);
    completeness.push(finding(`missing_${String(attr.key)}`, severity, `ขาด ${attr.label}`, `${missing.length}/${total} (${(pct * 100).toFixed(1)}%)`, missing.length, total, missing.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) }))));
  }
  const noSpecs = byFlag('missing_specs');
  if (noSpecs.length) completeness.push(finding('missing_specs', 'warning', 'ขาดสเปกสินค้า', `${noSpecs.length}/${total} ไม่มี specs — ลดความแม่นของ similarity`, noSpecs.length, total, noSpecs.slice(0, 3).map((p) => ({ id: p.product_id }))));

  // ── dimensions (น้ำหนัก 0: รายงานเพื่อการปรับปรุง ไม่กดคะแนนความพร้อม) ──
  const dimensions: Finding[] = [];
  const noSize = products.filter((p) => p.size_label == null);
  if (noSize.length) {
    dimensions.push(finding('missing_dimensions', 'info', 'ไม่พบขนาดเดียว', `${noSize.length}/${total} ไม่มีขนาดเดียวที่ใช้เทียบได้ (ขาดข้อมูล หรือมีหลายขนาดตามตัวเลือก) — ไม่กระทบ readiness`, noSize.length, total, noSize.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) }))));
  }
  const multiSize = byFlag('size_variant_multiple');
  if (multiSize.length) {
    dimensions.push(finding('size_variant_multiple', 'info', 'ตัวเลือกมีหลายขนาด', `${multiSize.length}/${total} มีตัวเลือกหลายขนาด — ไม่สรุปเป็นขนาดเดียว ต้องดูรายตัวเลือก`, multiSize.length, total, multiSize.slice(0, 3).map((p) => ({ id: p.product_id, sizes: p.size_options.slice(0, 4) }))));
  }

  // validity
  const validity: Finding[] = [];
  const badPrice = products.filter((p) => p.price <= 0);
  if (badPrice.length) validity.push(finding('price_invalid', 'critical', 'ราคาไม่ถูกต้อง', `${badPrice.length} records ราคา ≤ 0 — ใช้เป็นน้ำหนักไม่ได้`, badPrice.length, total, badPrice.slice(0, 3).map((p) => ({ id: p.product_id, price: p.price }))));
  const lowQuality = products.filter((p) => p.quality_score < 60);
  if (lowQuality.length) validity.push(finding('quality_below_60', 'warning', 'Quality score ต่ำกว่า 60', `${lowQuality.length}/${total} records ขาดหลายมิติ — ควรเก็บเข้า quarantine ก่อนใช้วิเคราะห์`, lowQuality.length, total, lowQuality.slice(0, 3).map((p) => ({ id: p.product_id, score: p.quality_score, flags: p.quality_flags }))));

  const sizeOutlier = byFlag('size_outlier');
  if (sizeOutlier.length) {
    validity.push(finding('size_outlier', 'warning', 'ขนาดผิดช่วงที่สมเหตุสมผล', `${sizeOutlier.length}/${total} แปลงขนาดได้แต่นอกช่วง 5–500 ซม. — ไม่นำไปใช้`, sizeOutlier.length, total, sizeOutlier.slice(0, 3).map((p) => ({ id: p.product_id, size: p.size_label ?? p.size_options.slice(0, 3) }))));
  }
  const badCurrency = products.filter((p) => p.currency !== 'THB');
  if (badCurrency.length) {
    validity.push(finding('currency_unsupported', 'warning', 'สกุลเงินไม่ใช่บาท', `${badCurrency.length}/${total} ตรวจพบสกุลเงินอื่น — เก็บตัวเลขไว้แต่ยังไม่แปลงอัตราแลกเปลี่ยน`, badCurrency.length, total, badCurrency.slice(0, 3).map((p) => ({ id: p.product_id, currency: p.currency, price: p.price_raw_text }))));
  }

  // consistency
  const consistency: Finding[] = [];
  const soldFlag = byFlag('sold_inconsistent');
  if (soldFlag.length) consistency.push(finding('sold_reconciled', 'info', 'reconcile ยอดขายแล้ว', `${soldFlag.length} records monthly > historical ถูกปรับ historical ขึ้น`, soldFlag.length, total, soldFlag.slice(0, 3).map((p) => ({ id: p.product_id, monthly: p.monthly_sold, historical: p.historical_sold })), true, 'reconcile-sold'));
  const discountFlag = byFlag('discount_mismatch');
  if (discountFlag.length) consistency.push(finding('discount_recomputed', 'info', 'คำนวณส่วนลดใหม่', `${discountFlag.length} records ส่วนลดจากต้นทางไม่ตรงกับราคา`, discountFlag.length, total, discountFlag.slice(0, 3).map((p) => ({ id: p.product_id })), true, 'recompute-discount'));
  const catMismatch = products.filter((p) => {
    const derived = detectCategory(p.name);
    return p.category !== 'other' && derived.score > 0 && derived.id !== p.category && derived.id !== 'other';
  });
  if (catMismatch.length) consistency.push(finding('category_conflict', 'info', 'หมวดหมู่ขัดกับชื่อ', `${catMismatch.length} records หมวดที่เลือกไม่ตรงกับคำในชื่อ`, catMismatch.length, total, catMismatch.slice(0, 3).map((p) => ({ id: p.product_id, category: p.category, derived: detectCategory(p.name).id }))));

  // text
  const text: Finding[] = [];
  const promo = byFlag('promo_noise');
  if (promo.length) text.push(finding('promo_noise_removed', 'info', 'ลบคำโฆษณาออกจากชื่อ', `${promo.length} ชื่อถูกตัดคำโฆษณา/emoji เพื่อให้จับคู่ได้`, promo.length, total, promo.slice(0, 3).map((p) => ({ id: p.product_id, before: p.name_raw.slice(0, 60), after: p.name.slice(0, 60) })), true, 'strip-promo'));
  const shortName = products.filter((p) => p.title_length < 8);
  if (shortName.length) text.push(finding('short_name', 'warning', 'ชื่อสั้นเกินไป', `${shortName.length} ชื่อ < 8 ตัวอักษร — similarity เชื่อถือไม่ได้`, shortName.length, total, shortName.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name }))));

  // uniqueness
  const uniqueness: Finding[] = [];
  const dupNames = new Map<string, NormalizedProduct[]>();
  products.forEach((p) => {
    const k = `${p.shop_id}|${nameKey(p.name)}`;
    if (!k.split('|')[1]) return;
    const list = dupNames.get(k) ?? [];
    list.push(p);
    dupNames.set(k, list);
  });
  const dupGroups = [...dupNames.values()].filter((g) => g.length > 1);
  if (dupGroups.length) {
    uniqueness.push(finding('duplicate_names', 'warning', 'ชื่อซ้ำหลัง normalize', `${dupGroups.length} กลุ่ม — อาจเป็นสินค้าซ้ำที่ควรยุบเป็น node เดียว`, dupGroups.length, total, dupGroups.slice(0, 3).map((g) => ({ shop: g[0].shop_name, name: g[0].name.slice(0, 50), count: g.length })), false));
  }

  if (canonical && canonical.groups > 0) {
    const proposed = canonical.linked === 0;
    uniqueness.push(
      finding(
        'multi_listing_products',
        'info',
        proposed ? 'พบ listing ที่น่าจะเป็นรุ่นเดียวกัน (ข้อเสนอ)' : 'สินค้ารุ่นเดียวกันหลาย listing',
        `${canonical.groups} กลุ่ม ครอบคลุม ${canonical.listings_in_groups} listings — ${proposed ? 'ยังไม่ลิงก์ในกราฟ (โหมดเสนอ)' : 'ลิงก์ด้วย edge same_product_as'}`,
        canonical.groups,
        total,
        [],
        false,
      ),
    );

    const byCanonical = new Map<string, NormalizedProduct[]>();
    for (const p of products) {
      if (!p.canonical_id) continue;
      const list = byCanonical.get(p.canonical_id) ?? [];
      list.push(p);
      byCanonical.set(p.canonical_id, list);
    }
    const priceGaps: Array<{ id: string; min: number; max: number; count: number }> = [];
    for (const [id, list] of byCanonical) {
      if (list.length < 2) continue;
      const prices = list.map((p) => p.price).filter((v) => v > 0);
      if (prices.length < 2) continue;
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (max / min > 1.2) priceGaps.push({ id, min, max, count: list.length });
    }
    if (priceGaps.length) {
      uniqueness.push(
        finding(
          'duplicate_listing_price_gap',
          'warning',
          'รุ่นเดียวกันแต่ราคาต่างกันมาก',
          `${priceGaps.length} กลุ่ม ราคาต่างเกิน 20% — ตรวจว่าเป็น listing ซ้ำหรือคนละเกรด`,
          priceGaps.length,
          total,
          priceGaps.slice(0, 3).map((g) => ({ canonical_id: g.id, min: g.min, max: g.max, listings: g.count })),
          false,
        ),
      );
    }
  }

  if (canonical && canonical.ambiguous.length) {
    uniqueness.push(
      finding(
        'canonical_ambiguous',
        'warning',
        'รหัสรุ่นซ้ำแต่คนละชนิดสินค้า',
        `${canonical.ambiguous.length} รหัสถูกใช้ในหลาย product_type — ไม่จัดกลุ่มข้ามชนิดให้`,
        canonical.ambiguous.length,
        total,
        canonical.ambiguous.slice(0, 3).map((code) => ({ code })),
        false,
      ),
    );
  }

  // ── enrichment (น้ำหนัก 0): ตรวจว่าตีความสินค้าได้แค่ไหน ──────────
  const enrichment: Finding[] = [];
  const cov = enrichmentCoverage(products);
  const missUse = total - cov.use_case;
  if (missUse > 0) {
    enrichment.push(finding('enrichment_missing_use_case', missUse / total > 0.6 ? 'warning' : 'info', 'ยังไม่รู้ use case', `${missUse}/${total} ไม่มีข้อความบอกว่าใช้ทำอะไร — เพิ่มคำอธิบาย/สเปกที่ต้นทาง หรือเพิ่มคำในพจนานุกรม`, missUse, total, products.filter((p) => p.enrichment.use_cases.length === 0).slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) }))));
  }
  const missCtx = total - cov.context;
  if (missCtx > 0) {
    enrichment.push(finding('enrichment_missing_context', missCtx / total > 0.6 ? 'warning' : 'info', 'ยังไม่รู้บริบทการใช้งาน', `${missCtx}/${total} ไม่มีคำบอกสถานที่ใช้ (ห้องนอน/มุมทำงาน/ครัว) — context node จะเบาบาง`, missCtx, total, products.filter((p) => p.enrichment.contexts.length === 0).slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) }))));
  }
  const missFn = total - cov.function;
  if (missFn > 0) {
    enrichment.push(finding('enrichment_missing_function', 'info', 'ยังไม่รู้ฟังก์ชันสินค้า', `${missFn}/${total} ไม่มีคำบอกหน้าที่การใช้งาน (ให้แสง/เก็บของ/ที่นั่ง)`, missFn, total, products.filter((p) => p.enrichment.functions.length === 0).slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) }))));
  }
  const sparse = byFlag('enrichment_sparse');
  if (sparse.length) {
    enrichment.push(finding('enrichment_sparse', 'warning', 'ชื่อสินค้าให้ข้อมูลไม่พอ', `${sparse.length}/${total} ไม่มีทั้ง use case และฟังก์ชัน — มักเป็นชื่อสั้น/มีแต่รุ่น`, sparse.length, total, sparse.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 50) }))));
  }
  if (cov.price_segment_absolute > 0) {
    const lowSampleCats = new Set(products.filter((p) => p.enrichment.price_segment.basis === 'absolute').map((p) => p.category));
    enrichment.push(finding('price_segment_low_sample', 'info', 'ช่วงราคายังใช้เกณฑ์คงที่', `${cov.price_segment_absolute}/${total} อยู่ในหมวดที่มีตัวอย่าง < 8 ชิ้น (${lowSampleCats.size} หมวด) — ยังเทียบกับตลาดไม่ได้`, cov.price_segment_absolute, total, [...lowSampleCats].slice(0, 5).map((c) => ({ category: c }))));
  }
  if (cov.price_segment_unknown > 0) {
    enrichment.push(finding('price_segment_unknown', 'warning', 'ไม่มีราคาจึงไม่จัดช่วงราคา', `${cov.price_segment_unknown}/${total} ราคา ≤ 0 — จัดช่วงราคาไม่ได้`, cov.price_segment_unknown, total, products.filter((p) => p.enrichment.price_segment.basis === 'unknown').slice(0, 3).map((p) => ({ id: p.product_id, price: p.price }))));
  }
  if (cov.style === 0 && total > 0) {
    enrichment.push(finding('enrichment_missing_style', 'info', 'ไม่พบสไตล์สินค้า', `ทั้ง ${total} records ไม่มีคำบอกสไตล์ที่ชัดเจน (ลอฟท์/โมเดิร์น/วินเทจ) — คำ SEO อย่างมินิมอล/ญี่ปุ่นไม่ถูกนับ`, total, total, []));
  }

  // ── AI enrichment (แยกจากหลักฐานเสมอ) ────────────────────────
  const aiTagged = products.filter((p) => (p.ai?.tags.length ?? 0) > 0);
  const hasAiData = products.some((p) => p.ai != null);
  if (!hasAiData) {
    enrichment.push(
      finding(
        'ai_missing',
        'info',
        'ยังไม่มีข้อมูลจาก AI',
        `${total} records ไม่มี ai_enrichment — ถ้าตั้ง AI_API_KEY ระบบจะสกัด use case/บริบท/กลุ่มผู้ใช้ให้อัตโนมัติ`,
        total,
        total,
        [],
      ),
    );
  } else {
    const groundedCount = products.filter((p) => (p.ai?.tags ?? []).some((t) => t.grounded)).length;
    const inferredCount = products.filter((p) => (p.ai?.tags ?? []).some((t) => !t.grounded)).length;
    const conflicts = products.flatMap((p) =>
      (p.ai?.tags ?? [])
        .filter((t) => t.conflict)
        .map((t) => ({ id: p.product_id, attribute: t.attribute, value: t.value })),
    );
    enrichment.push(
      finding(
        'ai_coverage',
        'info',
        'AI สกัด attribute แล้ว',
        `${aiTagged.length}/${total} มีแท็กจาก AI · ${groundedCount} อ้างคำจริงในข้อความ · ${inferredCount} เป็นการอนุมาน (แยกจากข้อมูลที่ตรวจสอบได้)`,
        aiTagged.length,
        total,
        aiTagged.slice(0, 3).map((p) => ({ id: p.product_id, tags: p.ai?.tags.length ?? 0 })),
      ),
    );
    if (conflicts.length) {
      enrichment.push(
        finding(
          'ai_conflict_with_rules',
          'info',
          'AI ขัดกับค่าที่ตรวจสอบได้',
          `${conflicts.length} ค่า — ระบบยึดค่าที่มีหลักฐานเป็นตัวจริง และเก็บของ AI แยกไว้ให้ตรวจ`,
          conflicts.length,
          total,
          conflicts.slice(0, 5),
        ),
      );
    }
  }

  // ── Phrase memory / AI gating / Vision ───────────────────────
  const phraseTags = products.flatMap((p) => (p.ai?.tags ?? []).filter((t) => t.origin === 'phrase'));
  const visualTags = products.flatMap((p) =>
    (p.ai?.tags ?? []).filter((t) => VISUAL_ATTR_IDS.includes(t.attribute as any)),
  );
  const visualRows = products.filter((p) =>
    (p.ai?.tags ?? []).some((t) => VISUAL_ATTR_IDS.includes(t.attribute as any)),
  );
  if (visualTags.length) {
    const grounded = visualTags.filter((t) => t.region || t.bbox).length;
    enrichment.push(
      finding(
        'visual_attributes',
        'info',
        'ค่าที่ได้จากการอ่านภาพ',
        `${visualRows.length}/${total} records มีค่าจากภาพ ${visualTags.length} ค่า · ${grounded} ค่ามีตำแหน่ง (region/bbox) ให้ตรวจซ้ำ · ${visualTags.length - grounded} ค่าไม่มีตำแหน่ง`,
        visualRows.length,
        total,
        visualRows.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) })),
      ),
    );
  }
  if (phraseTags.length) {
    const groundedCount = phraseTags.filter((t) => t.grounded).length;
    enrichment.push(
      finding(
        'phrase_memory_hits',
        'info',
        'ใช้พจนานุกรมวลีช่วยสกัด',
        `${phraseTags.length} ค่ามาจากวลีที่เรียนรู้แล้ว (${groundedCount} ยืนยันในข้อความจริง) — ไม่เสียค่า API`,
        phraseTags.length,
        total,
        [],
      ),
    );
  }
  const gatedRows = products.filter(
    (p) =>
      (p.enrichment?.use_cases.length ?? 0) > 0 &&
      (p.enrichment?.contexts.length ?? 0) > 0 &&
      (p.ai?.tags.length ?? 0) === 0,
  );
  if (gatedRows.length) {
    enrichment.push(
      finding(
        'ai_gated_by_rules',
        'info',
        'ข้าม AI เพราะกฎให้ข้อมูลครบแล้ว',
        `${gatedRows.length}/${total} มีทั้ง use case และบริบทจากหลักฐานแล้ว — ไม่ต้องจ่ายค่า AI เต็มรอบ (ยังมีค่าเฉพาะ attribute ที่กฎสร้างไม่ได้ถ้าเปิด focus pass)`,
        gatedRows.length,
        total,
        gatedRows.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) })),
      ),
    );
  }
  const visualMissing = products.filter(
    (p) => !(p.ai?.tags ?? []).some((t) => VISUAL_ATTR_IDS.includes(t.attribute as any)),
  );
  if (visualMissing.length) {
    const withImage = visualMissing.filter((p) => (p.images?.length ?? 0) > 0 || p.image);
    enrichment.push(
      finding(
        'visual_missing',
        'info',
        'ยังไม่มีค่าที่อ่านจากภาพ',
        `${visualMissing.length}/${total} ยังไม่มี visual attribute — ${withImage.length} มีรูปพร้อมส่งให้ VLM`,
        visualMissing.length,
        total,
        withImage.slice(0, 3).map((p) => ({ id: p.product_id, images: p.images?.length ?? 1 })),
      ),
    );
  }
  const pendingConflicts = detectAllConflicts(products);
  if (pendingConflicts.length) {
    const critical = pendingConflicts.filter((c) => c.severity === 'critical');
    enrichment.push(
      finding(
        'conflict_pending',
        critical.length ? 'warning' : 'info',
        'ค่าที่ AI ให้ขัดกับหลักฐาน — รอคนตรวจ',
        `${pendingConflicts.length} ค่า (${critical.length} ค่าเป็น attribute สำคัญ) — ระบบยึดหลักฐานเป็นตัวจริง เปิดคิวตรวจที่การ์ด "ขัดแย้งรอตรวจ"`,
        pendingConflicts.length,
        total,
        pendingConflicts.slice(0, 5).map((c) => ({ id: c.product_id, attribute: c.attribute, value: c.value_id })),
      ),
    );
  }

  // ── ค่าที่ admin แก้เอง (manual) — นับเป็นข้อมูลที่ตรวจสอบได้ ──
  const overridden = products.filter((p) => Object.keys(p.overrides ?? {}).length > 0);
  if (overridden.length) {
    const attrCount = overridden.reduce((sum, p) => sum + Object.keys(p.overrides ?? {}).length, 0);
    enrichment.push(
      finding(
        'manual_overrides',
        'info',
        'มีค่าที่ admin แก้เอง',
        `${overridden.length} records มีค่าที่แก้โดยคน ${attrCount} ค่า — ระบบใช้ค่านี้แทนหลักฐาน/AI ของ attribute เดียวกัน และไม่ถูก pipeline เขียนทับ`,
        overridden.length,
        total,
        overridden.slice(0, 3).map((p) => ({ id: p.product_id, attributes: Object.keys(p.overrides ?? {}) })),
      ),
    );
  }

  // network
  const networkFindings: Finding[] = [];
  const unknownCat = products.filter((p) => p.category === 'other' || p.category_confidence < 0.45);
  if (unknownCat.length) networkFindings.push(finding('weak_category', 'critical', 'หมวดหมู่อ่อน/ไม่ทราบ', `${unknownCat.length}/${total} ไม่มีหมวดที่มั่นใจ — clustering จะไม่มีโครงสร้าง`, unknownCat.length, total, unknownCat.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) })), true, 'infer-category'));
  const unknownType = products.filter((p) => p.product_type === 'other');
  if (unknownType.length) networkFindings.push(finding('weak_type', 'warning', 'ไม่ทราบชนิดสินค้า', `${unknownType.length}/${total} ไม่มี product_type — similarity/substitute จะไม่เกิด`, unknownType.length, total, unknownType.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) })), true, 'infer-type'));
  const noBrand = products.filter((p) => !p.brand);
  if (noBrand.length) networkFindings.push(finding('low_brand_coverage', noBrand.length / total > 0.7 ? 'warning' : 'info', 'ความครอบคลุมแบรนด์ต่ำ', `${total - noBrand.length}/${total} มีแบรนด์ (${(((total - noBrand.length) / total) * 100).toFixed(0)}%) — brand hub จะเบาบาง`, noBrand.length, total, noBrand.slice(0, 3).map((p) => ({ id: p.product_id, name: p.name.slice(0, 40) })), false));

  const catCounts = new Map<string, number>();
  products.forEach((p) => catCounts.set(p.category, (catCounts.get(p.category) ?? 0) + 1));
  const topCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCat && topCat[1] / total > 0.85 && total > 10) {
    networkFindings.push(finding('single_category_dominance', 'warning', 'หมวดเดียวครองข้อมูล', `${topCat[1]}/${total} อยู่ใน "${topCat[0]}" (${((topCat[1] / total) * 100).toFixed(0)}%) — graph จะแบน`, topCat[1], total, [], false));
  }

  if (graph) {
    const shopNodes = graph.nodes.filter((n) => n.type === 'shop');
    const singleShop = shopNodes.filter((n) => Number(n.attributes.product_count ?? 0) === 1).length;
    if (shopNodes.length > 1 && singleShop / shopNodes.length > 0.5) {
      networkFindings.push(finding('shop_fanout_low', 'info', 'ร้านส่วนใหญ่มีสินค้าเดียว', `${singleShop}/${shopNodes.length} ร้านมีสินค้า 1 ชิ้น — shop hub เบาบาง`, singleShop, shopNodes.length, [], false));
    }
    if (graph.stats.isolate_ratio > 0.3) {
      networkFindings.push(finding('isolated_products', 'warning', 'สินค้าโดดเดี่ยว (isolate)', `${graph.stats.isolates.length}/${graph.stats.product_count} product nodes ไม่มี edge เชื่อมกับสินค้าอื่น`, graph.stats.isolates.length, graph.stats.product_count, graph.stats.isolates.slice(0, 5).map((id) => ({ id })), true, 'relax-similarity'));
    }
    if (graph.stats.components > 1) {
      networkFindings.push(finding('disconnected_components', graph.stats.components > 5 ? 'warning' : 'info', 'กราฟแตกเป็นหลายกลุ่ม', `${graph.stats.components} connected components (ใหญ่สุด ${graph.stats.largest_component} nodes)`, graph.stats.components, graph.stats.product_count, graph.stats.component_sizes.slice(0, 5).map((n) => ({ size: n })), false));
    }
    const topShopShare = topHubShare(graph, 'shop');
    if (topShopShare.ratio > 0.3 && total > 20) {
      networkFindings.push(finding('hub_dominance', 'info', 'ร้านเดียวครองกราฟ', `ร้าน "${topShopShare.label}" มี ${topShopShare.count} สินค้า (${(topShopShare.ratio * 100).toFixed(0)}%) — ระวัง degree bias`, topShopShare.count, total, [], false));
    }
    if (graph.stats.avg_degree < 1) {
      networkFindings.push(finding('sparse_graph', 'warning', 'กราฟเบาบาง', `degree เฉลี่ย ${graph.stats.avg_degree.toFixed(2)} — ยังไม่พอสำหรับ community detection`, 1, total, [], false));
    }
  }

  const sections = [
    section('identity', 'Identity & Integrity', '🆔', identity),
    section('completeness', 'Attribute Coverage', '📋', completeness),
    section('dimensions', 'ขนาด & ตัวเลือก', '📐', dimensions),
    section('enrichment', 'Product Understanding', '🧠', enrichment),
    section('validity', 'Validity & Quality', '✓', validity),
    section('consistency', 'Consistency', '⚖️', consistency),
    section('text', 'Text Normalization', '📝', text),
    section('uniqueness', 'Uniqueness', '🔍', uniqueness),
    section('network', 'Network Readiness', '🕸️', networkFindings),
  ];

  const readiness = graph
    ? graph.stats.readiness
    : estimateReadiness(products.map((p) => ({
        product_id: p.product_id,
        shop_id: p.shop_id,
        category: p.category,
        product_type: p.product_type,
        brand: p.brand,
        province: p.province,
      })), products);

  const report = buildReport(source, total, sections, readiness);
  if (graph) {
    report.projection = {
      node_count: graph.stats.node_count,
      edge_count: graph.stats.edge_count,
      by_node_type: graph.stats.by_node_type,
      by_edge_type: graph.stats.by_edge_type,
      isolates: graph.stats.isolates.length,
      isolate_ratio: graph.stats.isolate_ratio,
      avg_degree: graph.stats.avg_degree,
      components: graph.stats.components,
    };
  }
  return report;
}

function topHubShare(graph: Graph, type: 'shop' | 'brand' | 'category') {
  const counts = new Map<string, { label: string; count: number }>();
  for (const node of graph.nodes) {
    if (node.type !== type) continue;
    if (type === 'shop') {
      const products = Number(node.attributes.product_count ?? 0);
      counts.set(node.id, { label: node.label, count: products });
    } else {
      const degree = graph.edges.filter((e) => e.source === node.id || e.target === node.id).length;
      counts.set(node.id, { label: node.label, count: degree });
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  const all = sorted.reduce((n, x) => n + x.count, 0) || 1;
  return { label: sorted[0]?.label ?? '—', count: sorted[0]?.count ?? 0, ratio: (sorted[0]?.count ?? 0) / all };
}

/** ประมาณ readiness จาก coverage โดยไม่ต้องสร้าง graph */
function estimateReadiness(
  rows: Array<{
    product_id?: string;
    shop_id?: string;
    category?: string;
    product_type?: string;
    brand?: string | null;
    province?: string;
  }>,
  raw: any[],
): number {
  const n = rows.length || 1;
  const has = (f: (r: any) => boolean) => rows.filter(f).length / n;
  const identity = (rows.filter((r) => r.product_id && r.shop_id).length / n) * 100;
  const category = has((r) => r.category && r.category !== 'other' && r.category !== 'Other') * 100;
  const type = has((r) => r.product_type && r.product_type !== 'other') * 100;
  const brand = has((r) => !!r.brand) * 100;
  const province = has((r) => r.province && r.province !== 'ไม่ระบุ') * 100;
  const specs = raw.length
    ? raw.filter((p) => Array.isArray(p.specs) && p.specs.length).length / raw.length * 100
    : 0;
  const uniqueness = (() => {
    const ids = new Set(rows.map((r) => r.product_id).filter(Boolean));
    return rows.length ? (ids.size / rows.length) * 100 : 0;
  })();
  return (
    identity * 0.3 +
    category * 0.15 +
    type * 0.15 +
    brand * 0.08 +
    province * 0.07 +
    specs * 0.1 +
    uniqueness * 0.15
  );
}

export { ratio };
