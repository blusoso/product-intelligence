import type {
  AiEnrichment,
  AttributeOverrideMap,
  CleanChange,
  NormalizedProduct,
  ProductFeatures,
  ProductVariant,
  SpecPair,
} from './types';
import {
  clamp,
  cleanProductName,
  detectCurrency,
  parseMoney,
  parseNumber,
  parseQuantity,
  ratio,
  round,
  slugKey,
  tokenize,
} from './text';
import {
  detectBrand,
  detectCategory,
  detectFeatureList,
  detectProductType,
  detectProvince,
  typeCategory,
  COLORS,
  MATERIALS,
  typeLabel,
} from './taxonomy';
import { detectSize, parseSize } from './dimensions';
import { enrichProduct } from './enrich';
import { deriveTrustRisk } from './trust';

export interface NormalizeOptions {
  /** วันที่ใช้ตัดสินความสดของข้อมูล (default = now) */
  now?: Date;
  /** อายุข้อมูล (วัน) ที่ถือว่าเก่า */
  stale_after_days?: number;
}

export interface NormalizeResult {
  product: NormalizedProduct;
  changes: CleanChange[];
}

function firstOf(...values: any[]): any {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function firstString(...values: any[]): string | null {
  const v = firstOf(...values);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function asArray<T = any>(v: any): T[] {
  if (Array.isArray(v)) return v as T[];
  return [];
}

function specPairs(raw: any): SpecPair[] {
  const out: SpecPair[] = [];
  const src = raw?.specs ?? raw?.specifications ?? raw?.attributes;
  if (Array.isArray(src)) {
    for (const s of src) {
      if (!s) continue;
      const name = String(s.name ?? s.key ?? s.label ?? '').trim();
      const value = String(s.value ?? s.val ?? '').trim();
      if (name && value) out.push({ name, value });
    }
  } else if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      if (v == null) continue;
      out.push({ name: String(k).trim(), value: String(v).trim() });
    }
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseIdentity(raw: any): {
  platform: string;
  shop_id: string;
  product_id: string;
  ext: string;
  healed: boolean;
  platform_missing: boolean;
} {
  const ext = String(raw.ext ?? '').trim();
  const parts = ext.split(':');
  const declared = String(raw.plat ?? raw.platform ?? parts[0] ?? '').trim().toLowerCase();
  const platform = declared || 'shopee';
  let shopId = String(raw.shop_id ?? '').trim();
  let productId = String(raw.product_id ?? '').trim();
  let healed = false;

  if (parts.length >= 3) {
    if (!shopId && parts[1]) {
      shopId = parts[1];
      healed = true;
    }
    if (!productId && parts[2]) {
      productId = parts[2];
      healed = true;
    }
  }
  return {
    platform,
    shop_id: shopId,
    product_id: productId,
    ext: ext || slugKey('ext', platform, shopId || 'unknown', productId || 'unknown'),
    healed,
    platform_missing: !declared,
  };
}

function isUnavailable(raw: any): boolean {
  const v = raw?.is_unavailable;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function normalizeInStock(raw: any): boolean {
  if (isUnavailable(raw)) return false;
  if (typeof raw.in_stock === 'boolean') return raw.in_stock;
  if (raw.in_stock === 0 || raw.in_stock === 1) return Boolean(raw.in_stock);
  const status = Number(raw.item_status);
  if (Number.isFinite(status) && status > 0) return status === 1;
  return false;
}

function normalizeSold(raw: any, changes: CleanChange[], flags: string[], pid: string): {
  monthly: number;
  historical: number;
} {
  const monthlyRaw = parseQuantity(firstOf(raw.monthly_sold, raw.sold_monthly, raw.sold)) ?? 0;
  const historicalRaw = parseQuantity(firstOf(raw.historical_sold, raw.sold_total, raw.total_sold)) ?? 0;
  let monthly = Math.max(0, Math.round(monthlyRaw));
  let historical = Math.max(0, Math.round(historicalRaw));

  if (monthlyRaw < 0) {
    changes.push({ product_id: pid, field: 'monthly_sold', before: monthlyRaw, after: 0, rule: 'clamp-negative' });
    flags.push('negative_sold');
  }
  if (historicalRaw < 0) {
    changes.push({ product_id: pid, field: 'historical_sold', before: historicalRaw, after: 0, rule: 'clamp-negative' });
    flags.push('negative_sold');
  }
  if (monthly > historical) {
    changes.push({
      product_id: pid,
      field: 'historical_sold',
      before: historical,
      after: monthly,
      rule: 'reconcile-monthly-exceeds-historical',
    });
    historical = monthly;
    flags.push('sold_inconsistent');
  }
  return { monthly, historical };
}

function ageDays(raw: any): number | null {
  const direct = parseNumber(firstOf(raw.listing_age_days, raw.age_days));
  if (direct != null) return direct;
  const ctime = parseNumber(firstOf(raw.ctime, raw.create_time, raw.created_at));
  if (ctime != null && ctime > 0) {
    const ms = ctime > 1e12 ? ctime : ctime * 1000;
    return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  }
  return null;
}

function priceBand(price: number): ProductFeatures['price_band'] {
  if (!price || price <= 0) return 'Invalid';
  if (price < 100) return 'Budget';
  if (price < 500) return 'Cheap';
  if (price < 2000) return 'Mid';
  if (price < 10000) return 'Premium';
  return 'Luxury';
}

function velocityBand(monthly: number, historical: number): ProductFeatures['velocity_band'] {
  if (monthly === 0 && historical === 0) return 'None';
  if (monthly === 0 && historical > 500) return 'Legacy';
  const rate = historical > 0 ? monthly / historical : 1;
  if (rate > 0.5) return 'Fast';
  if (rate > 0.2) return 'Normal';
  if (rate > 0) return 'Slow';
  return 'New';
}

function ageBand(days: number | null): string {
  if (days == null) return 'Unknown';
  if (days < 30) return 'New (<1m)';
  if (days < 90) return 'Recent (<3m)';
  if (days < 180) return 'Established (<6m)';
  if (days < 365) return 'Mature (<1y)';
  return 'Old (>1y)';
}

function trustBand(score: number): ProductFeatures['trust_band'] {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

function featureText(raw: any, name: string, specs: SpecPair[]): string {
  const options = asArray(raw.options)
    .slice(0, 8)
    .map((o: any) => String(o?.name ?? ''))
    .join(' ');
  return [name, ...specs.map((s) => `${s.name} ${s.value}`), options].join(' ');
}

/** ตัวเลือก/SKU: ราคา-สต็อก-ขนาด แยกตามตัวเลือก (จำกัด 200 ตัวเลือกเพื่อความเร็ว) */
function parseVariants(raw: any): { variants: ProductVariant[]; axes: string[] } {
  const variants: ProductVariant[] = [];
  for (const o of asArray(raw?.options)) {
    if (!o || typeof o !== 'object') continue;
    if (variants.length >= 200) break;
    const name = String(o.name ?? '').trim();
    const price = parseMoney(o.price);
    const stock = parseQuantity(o.stock);
    const size = parseSize(name);
    variants.push({
      model_id: String(o.model_id ?? o.modelId ?? o.id ?? '').trim(),
      name,
      price: price != null && price > 0 ? price : null,
      stock: stock != null ? Math.max(0, Math.round(stock)) : null,
      stock_known: o.stock_known === true,
      available:
        o.available !== false &&
        (o.status == null || Number(o.status) === 1) &&
        o.is_grayout !== true,
      color: detectFeatureList(name, COLORS)[0] ?? null,
      size_label: size && !size.outlier ? size.label : null,
      width_cm: size && !size.outlier ? size.width_cm : null,
      depth_cm: size && !size.outlier ? size.depth_cm : null,
    });
  }
  const axes = asArray(raw?.tier_variations)
    .map((t: any) => String(t?.name ?? '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return { variants, axes };
}

export function normalizeProduct(raw: any, options: NormalizeOptions = {}): NormalizeResult {
  const changes: CleanChange[] = [];
  const repaired: string[] = [];
  const flags: string[] = [];
  const id = parseIdentity(raw);
  const pid = id.product_id || id.ext;

  if (id.healed) flags.push('identity_healed');
  if (id.platform_missing) flags.push('platform_missing');
  if (!id.product_id) flags.push('missing_product_id');
  if (!id.shop_id) flags.push('missing_shop_id');

  const { variants, axes: variantAxes } = parseVariants(raw);

  // ── ชื่อสินค้า ──────────────────────────────────────────────
  const nameRaw = String(firstOf(raw.name, raw.product_name, raw.title) ?? '').trim();
  const cleaned = cleanProductName(nameRaw);
  const name = cleaned.text || nameRaw;
  repaired.push(...cleaned.repaired);
  if (cleaned.repaired.includes('mojibake')) flags.push('encoding_repaired');
  if (cleaned.repaired.includes('html')) flags.push('html_removed');
  if (cleaned.repaired.includes('zero_width')) flags.push('zero_width_removed');
  if (!name) flags.push('empty_name');
  else if (name.length < 8) flags.push('short_name');
  if (cleaned.emoji > 3) flags.push('emoji_heavy');

  if (name !== nameRaw) {
    changes.push({ product_id: pid, field: 'name', before: nameRaw, after: name, rule: 'clean-name' });
  }

  // ── ราคา ────────────────────────────────────────────────────
  const priceRaw = firstOf(raw.price, raw.price_min, raw.price_max);
  const priceText = priceRaw == null ? '' : String(priceRaw).trim();
  const parsedPrice = parseMoney(priceRaw);
  let price = Math.max(0, parsedPrice ?? 0);
  const currency = detectCurrency(firstOf(priceText, raw.currency, raw.currency_code));
  if (!price) {
    flags.push('price_invalid');
    if (parsedPrice == null && priceText) flags.push('price_unparsed');
    if (priceRaw != null) {
      changes.push({ product_id: pid, field: 'price', before: priceRaw, after: 0, rule: 'parse-money' });
    }
  } else if (/[^\d.,\s]/.test(priceText)) {
    changes.push({ product_id: pid, field: 'price', before: priceText, after: parsedPrice, rule: 'parse-money' });
  }
  if (currency !== 'THB') flags.push('currency_unsupported');

  // ราคาสินค้าว่าง แต่ตัวเลือกมีราคา → ใช้ราคาต่ำสุดที่ยังขายอยู่ (บันทึกที่มาไว้)
  let priceSource: 'item' | 'variant_min' = 'item';
  if (!price && variants.length) {
    const available = variants.filter((v) => v.available && v.price != null).map((v) => v.price as number);
    const pool = available.length ? available : variants.map((v) => v.price).filter((v): v is number => v != null);
    if (pool.length) {
      price = Math.min(...pool);
      priceSource = 'variant_min';
      flags.push('price_from_variant');
    }
  }

  let before = parseMoney(firstOf(raw.price_before_discount, raw.price_before, raw.original_price));
  const declaredDiscount = parseNumber(firstOf(raw.discount_pct, raw.discount));
  let discount = 0;

  if (before != null && before > 0) {
    if (before <= price) {
      changes.push({
        product_id: pid,
        field: 'price_before_discount',
        before: before,
        after: null,
        rule: 'drop-illogical-discount',
      });
      flags.push('discount_inconsistent');
      before = null;
    } else {
      discount = Math.round((1 - price / before) * 100);
      if (declaredDiscount != null && Math.abs(declaredDiscount - discount) > 1) {
        flags.push('discount_mismatch');
        changes.push({
          product_id: pid,
          field: 'discount_pct',
          before: declaredDiscount,
          after: discount,
          rule: 'recompute-discount',
        });
      }
    }
  } else {
    before = null;
  }
  if (discount < 0 || discount > 99) discount = clamp(discount, 0, 99);

  // ── ยอดขาย ──────────────────────────────────────────────────
  const sold = normalizeSold(raw, changes, flags, pid);
  const gmv = Math.round(sold.monthly * price);

  // ── Rating / reviews ───────────────────────────────────────
  let rating = parseNumber(firstOf(raw.rating, raw.rating_star));
  if (rating != null) {
    if (rating < 0 || rating > 5) {
      flags.push('rating_out_of_range');
      changes.push({
        product_id: pid,
        field: 'rating',
        before: rating,
        after: clamp(rating, 0, 5),
        rule: 'clamp-rating',
      });
      rating = clamp(rating, 0, 5);
    }
    if (rating === 0) rating = null;
    else rating = round(rating, 2);
  }

  const ratingDist = (raw.rating_dist && typeof raw.rating_dist === 'object') ? raw.rating_dist : {};
  const distTotal = parseNumber(ratingDist.total) ?? 0;
  let reviews = Math.max(0, Math.round(parseNumber(firstOf(raw.review_count, raw.reviews_count)) ?? 0));
  if (distTotal > reviews) {
    changes.push({
      product_id: pid,
      field: 'review_count',
      before: reviews,
      after: distTotal,
      rule: 'prefer-rating-dist-total',
    });
    reviews = distTotal;
    flags.push('review_count_reconciled');
  }
  if (reviews === 0 && distTotal === 0) flags.push('no_reviews');

  // ── Trust ──────────────────────────────────────────────────
  const trust = clamp(parseNumber(firstOf(raw.trust_score, raw.t)) ?? 0, 0, 100);

  // ── อายุสินค้า ─────────────────────────────────────────────
  let age = ageDays(raw);
  if (age != null) {
    const rounded = Math.max(0, Math.round(age));
    if (rounded !== age) {
      changes.push({ product_id: pid, field: 'listing_age_days', before: age, after: rounded, rule: 'round-age' });
    }
    age = rounded;
    if (age < 0) {
      age = 0;
      flags.push('negative_age');
    }
    if (age > 3650) flags.push('age_outlier');
  } else {
    flags.push('age_unknown');
  }

  // ── ที่ตั้ง ────────────────────────────────────────────────
  const provinceRaw = firstOf(raw.location, raw.shop_location, raw.province);
  const provinceField = raw.location
    ? 'location'
    : raw.shop_location
      ? 'shop_location'
      : raw.province
        ? 'province'
        : null;
  const loc = detectProvince(provinceRaw);
  if (loc.province === 'ไม่ระบุ') flags.push('location_unknown');
  const provinceEvidence =
    loc.province !== 'ไม่ระบุ' && provinceRaw
      ? `${provinceField ?? 'province'}: ${String(provinceRaw).trim()}`
      : null;

  // ── Specs / attributes ────────────────────────────────────
  const specs = specPairs(raw);
  const featureStr = featureText(raw, name, specs);

  // ── ขนาด / มิติ ───────────────────────────────────────────
  const size = detectSize(raw);
  if (size.outlier) flags.push('size_outlier');
  if (size.variable) flags.push('size_variant_multiple');
  if (!size.size) flags.push('size_missing');
  else {
    if (size.size.dimensions < 3) flags.push('size_partial');
    if (size.size.unit_assumed) flags.push('size_unit_assumed');
  }

  const typeMatch = detectProductType(featureStr);
  const catMatch = detectCategory(featureStr);
  const type = typeMatch.score > 0 ? typeMatch.id : 'other';
  const typeConf = typeMatch.confidence;
  let category = type !== 'other' ? typeCategory(type) : catMatch.id;
  let categoryConf = type !== 'other' ? Math.max(catMatch.confidence, typeConf) : catMatch.confidence;

  // ค่า cat เดิมจากระบบ (ถ้ามีและเชื่อถือได้) ใช้เมื่อตัวจำแนกใหม่ไม่มั่นใจ
  const legacyCat = String(raw.cat ?? '').trim();
  if ((!category || category === 'other') && legacyCat && legacyCat !== 'Other') {
    category = legacyCat;
    categoryConf = 0.4;
  }
  if (!category || category === 'other') {
    category = 'other';
    categoryConf = 0;
    flags.push('category_unknown');
  } else if (categoryConf < 0.45) {
    flags.push('category_low_confidence');
  }
  if (type === 'other') flags.push('type_unknown');

  const brandMatch = detectBrand(name, specs, String(raw.shop_name ?? ''));
  if (!brandMatch.brand) flags.push('brand_missing');

  const materials = detectFeatureList(featureStr, MATERIALS);
  const colors = detectFeatureList(featureStr, COLORS);

  // ── รูปภาพ: เก็บทั้งหน้าปกและรูปทั้งหมด (cap 8) เพื่อให้ชั้น vision เลือกใช้ ──
  const imageCandidates: unknown[] = [
    ...asArray(raw.images_all),
    raw.cover_image,
    raw.image,
    raw.image_url,
  ];
  const images: string[] = [];
  for (const candidate of imageCandidates) {
    const url =
      typeof candidate === 'string'
        ? candidate.trim()
        : candidate && typeof candidate === 'object'
          ? String((candidate as any).url ?? (candidate as any).src ?? '').trim()
          : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (images.includes(url)) continue;
    images.push(url);
    if (images.length >= 8) break;
  }
  const image = images[0] ?? null;
  if (!image) flags.push('missing_image');

  const optionCount = asArray(raw.options).length ||
    Math.round(parseNumber(raw.options_count) ?? 0);
  if (specs.length === 0) flags.push('missing_specs');

  // ── ความสดของข้อมูล ──────────────────────────────────────
  const ingested = firstOf(raw.last_ingested_at, raw.ingested_at, raw.exported_at, raw.updated_at);
  let ingestedAt: string | null = null;
  if (ingested) {
    const d = new Date(String(ingested));
    if (!Number.isNaN(d.getTime())) ingestedAt = d.toISOString();
  }
  // ระบบเห็น listing นี้ครั้งแรกเมื่อไร (products.first_seen_at / raw_products)
  const firstSeenRaw = firstOf(raw.first_seen_at, raw.first_seen);
  let firstSeenAt: string | null = null;
  if (firstSeenRaw) {
    const d = new Date(String(firstSeenRaw));
    if (!Number.isNaN(d.getTime())) firstSeenAt = d.toISOString();
  }
  const now = options.now ?? new Date();
  const staleAfter = options.stale_after_days ?? 90;
  if (ingestedAt) {
    const days = (now.getTime() - new Date(ingestedAt).getTime()) / 86400000;
    if (days > staleAfter) flags.push('stale_data');
  } else {
    flags.push('no_timestamp');
  }

  // ── คุณภาพระดับ record (0–100) ────────────────────────────
  let quality = 0;
  quality += id.product_id ? 15 : 0;
  quality += id.shop_id ? 10 : 0;
  quality += name ? (name.length >= 8 ? 10 : 5) : 0;
  quality += price > 0 ? 15 : 0;
  quality += category !== 'other' && categoryConf >= 0.45 ? 10 : category !== 'other' ? 5 : 0;
  quality += type !== 'other' && typeConf >= 0.45 ? 10 : type !== 'other' ? 5 : 0;
  quality += brandMatch.brand ? 5 : 0;
  quality += rating != null ? 5 : 0;
  quality += reviews > 0 ? 5 : 0;
  quality += sold.historical > 0 ? 5 : 0;
  quality += specs.length > 0 ? 5 : 0;
  quality += image ? 5 : 0;
  const qualityScore = clamp(Math.round(quality), 0, 100);

  const coreFields = [
    id.product_id, id.shop_id, name, price, category !== 'other' ? category : '',
    rating, reviews, sold.historical, image, loc.province !== 'ไม่ระบุ' ? loc.province : '',
  ];
  const completeness = Math.round((coreFields.filter((v) => v !== '' && v != null && v !== 0).length / coreFields.length) * 100);

  const nameTokens = tokenize(name);

  const variantPrices = variants
    .map((v) => v.price)
    .filter((v): v is number => v != null && v > 0);
  const variantPriceMin = variantPrices.length ? Math.min(...variantPrices) : null;
  const variantPriceMax = variantPrices.length ? Math.max(...variantPrices) : null;

  // ── Product Understanding & Enrichment ─────────────────────
  // ตีความ "ใช้ทำอะไร/ทำหน้าที่อะไร/ใช้ที่ไหน/สไตล์/พื้นที่" พร้อมหลักฐาน
  // price segment เติมทีหลังใน pipeline (ต้องเทียบทั้งหมวด)
  const enrichment = enrichProduct({
    name,
    specs,
    options: asArray(raw.options)
      .slice(0, 20)
      .map((o: any) => String(o?.name ?? '')),
    category,
    product_type: type,
    width_cm: size.size?.width_cm ?? null,
    depth_cm: size.size?.depth_cm ?? null,
  });
  if (enrichment.use_cases.length === 0 && enrichment.functions.length === 0) {
    flags.push('enrichment_sparse');
  }
  if (enrichment.contexts.length === 0) flags.push('context_missing');

  // ค่าที่ AI อนุมาน (ถ้าเคยบันทึกไว้ใน DB) — แยก object จาก enrichment เสมอ
  const ai = asAiEnrichment(raw.ai_enrichment) ?? asAiEnrichment(raw.ai);

  // Trust Risk: ตรวจรีวิว/นโยบายร้าน/ความพร้อมขาย/ความสอดคล้องของยอดขาย
  if (isUnavailable(raw)) flags.push('unavailable');
  const trustRisk = deriveTrustRisk(raw, {
    sold_inconsistent: flags.includes('sold_inconsistent'),
  });

  const features: ProductFeatures = {
    price_band: priceBand(price),
    velocity_band: velocityBand(sold.monthly, sold.historical),
    age_band: ageBand(age),
    trust_band: trustBand(trust),
    name_length: name.length,
    name_tokens: nameTokens.length,
    spec_count: specs.length,
    option_count: optionCount,
    gmv_monthly: gmv,
    sold_ratio: sold.historical > 0 ? round(sold.monthly / sold.historical, 3) : null,
  };

  const product: NormalizedProduct = {
    node_key: slugKey('product', id.platform, id.shop_id || 'unknown', id.product_id || id.ext),
    ext: id.ext,
    product_id: id.product_id,
    shop_id: id.shop_id,
    platform: id.platform,
    shop_name: String(raw.shop_name ?? '').trim(),
    name,
    name_raw: nameRaw,
    name_tokens: nameTokens,
    category,
    category_confidence: categoryConf,
    product_type: type,
    type_confidence: type === 'other' ? 0 : Math.max(typeConf, 0.5),
    brand: brandMatch.brand,
    brand_confidence: brandMatch.confidence,
    brand_evidence: brandMatch.evidence ?? null,
    province: loc.province,
    region: loc.region,
    province_evidence: provinceEvidence,
    price,
    price_before_discount: before,
    discount_pct: discount,
    currency,
    price_raw_text: priceText,
    price_source: priceSource,
    width_cm: size.size?.width_cm ?? null,
    depth_cm: size.size?.depth_cm ?? null,
    height_cm: size.size?.height_cm ?? null,
    size_label: size.size?.label ?? null,
    size_source: size.size ? size.source : null,
    size_confidence: size.size ? size.confidence : 0,
    size_options: size.options,
    variants,
    variant_count: variants.length,
    variant_price_min: variantPriceMin,
    variant_price_max: variantPriceMax,
    variant_axes: variantAxes,
    canonical_id: null,
    canonical_confidence: 0,
    canonical_evidence: null,
    listing_count: 1,
    is_primary_listing: true,
    monthly_sold: sold.monthly,
    historical_sold: sold.historical,
    rating,
    review_count: reviews,
    trust_score: trust,
    datasource_tier: firstString(raw.tier, raw.datasource_tier),
    seller_flag: firstString(raw.seller_flag),
    is_unavailable: isUnavailable(raw),
    listing_age_days: age,
    in_stock: normalizeInStock(raw),
    is_ad: raw.is_ad === true || raw.is_ad === 1,
    shopee_verified: raw.shopee_verified === true || raw.shopee_verified === 1,
    url: String(raw.url ?? ''),
    image,
    images,
    description: String(raw.description ?? '').slice(0, 4000),
    title_length: name.length,
    spec_count: specs.length,
    option_count: optionCount,
    materials,
    colors,
    room: enrichment.contexts[0]?.value ?? null,
    style: enrichment.styles[0]?.value ?? null,
    enrichment,
    ai,
    // ค่าที่ admin แก้เอง (ถ้ามี) — ใช้แทนค่าของ attribute นั้นตอนแสดงผล
    overrides: asOverrides(raw.attribute_overrides),
    specs,
    features,
    quality_score: qualityScore,
    completeness,
    quality_flags: [...new Set(flags)],
    trust_risk: trustRisk,
    repaired: [...new Set(repaired)],
    ingested_at: ingestedAt,
    updated_at: ingestedAt,
    first_seen_at: firstSeenAt,
  };

  return { product, changes };
}

export function describeType(type: string): string {
  return typeLabel(type) || type;
}

/** ตรวจรูปร่างของ ai_enrichment ที่อ่านจาก DB/ไฟล์ ก่อนนำไปใช้ */
function asAiEnrichment(v: any): AiEnrichment | null {
  if (!v || typeof v !== 'object' || !Array.isArray(v.tags)) return null;
  return v as AiEnrichment;
}

/** ตรวจรูปร่างของ attribute_overrides (ค่าที่ admin แก้) */
function asOverrides(v: any): AttributeOverrideMap | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: AttributeOverrideMap = {};
  for (const [attr, raw] of Object.entries<any>(v)) {
    const values = Array.isArray(raw?.values) ? raw.values : [];
    const clean = values
      .map((x: any) => ({
        value_id: String(x?.value_id ?? '').trim(),
        label: String(x?.label ?? x?.value_id ?? '').trim(),
      }))
      .filter((x: any) => x.value_id);
    if (!clean.length) continue;
    out[attr] = {
      values: clean,
      at: String(raw?.at ?? ''),
      by: String(raw?.by ?? 'admin'),
      ...(raw?.note ? { note: String(raw.note) } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

export function priceCompatibility(a: number, b: number): number {
  if (!a || !b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return lo / hi;
}

export function soldWeight(p: NormalizedProduct): number {
  return Math.log10(1 + Math.max(0, p.monthly_sold)) + Math.log10(1 + Math.max(0, p.review_count));
}

export function normalizeBatch(products: any[], options?: NormalizeOptions): {
  products: NormalizedProduct[];
  changes: CleanChange[];
} {
  const out: NormalizedProduct[] = [];
  const changes: CleanChange[] = [];
  for (const raw of products) {
    const { product, changes: c } = normalizeProduct(raw, options);
    out.push(product);
    changes.push(...c);
  }
  return { products: out, changes };
}

export { ratio };
