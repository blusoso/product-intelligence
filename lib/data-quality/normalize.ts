const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['Home & Living', /โต๊ะ|เก้าอี้|ชั้นวาง|โซฟา|เตียง|หมอน|ผ้า|พรม|โต๊ะทำงาน|เก้าอี้สำนักงาน|table|chair|desk|sofa|bed/i],
  ['Gadget',        /iphone|android|หูฟัง|เคสโทรศัพท์|คอม|tablet|ipad|laptop|เมาส์|คีย์บอร์ด|มือถือ|earbud|headset|mouse|keyboard/i],
  ['Beauty',        /ครีม|เซรั่ม|ลิป|แป้งแต่งหน้า|โลชั่น|สกินแคร์|serum|cream|lip|skin|cleanser|toner/i],
  ['Fashion',       /เสื้อ|กางเกง|กระเป๋า|รองเท้า|tote|shirt|bag|dress|jeans|shoes/i],
  ['Sport',         /วิ่ง|ฟิตเนส|โยคะ|dumbbell|กีฬา|fitness|yoga|run/i],
  ['Kids',          /เด็ก|ของเล่น|ทารก|baby|kid|toy/i],
];

const KNOWN_BRANDS = [
  'Apple', 'Samsung', 'Xiaomi', 'OPPO', 'vivo', 'realme', 'Huawei', 'Sony',
  'JBL', 'Bose', 'Anker', 'Baseus', 'UGREEN', 'Philips', 'Panasonic',
  'Nike', 'Adidas', 'Puma', 'Uniqlo', 'H&M', 'Zara',
  'Loreal', "L'Oreal", 'Nivea', 'Cetaphil', 'CeraVe', 'La Roche-Posay',
  'IKEA', 'MUJI', 'Index', 'SB Design',
];

const LOCATION_MAP: [string, string][] = [
  ['กทม', 'Bangkok'],
  ['กรุงเทพ', 'Bangkok'],
  ['bangkok', 'Bangkok'],
  ['นนทบุรี', 'Nonthaburi'],
  ['ปทุมธานี', 'Pathum Thani'],
  ['สมุทรปราการ', 'Samut Prakan'],
  ['เชียงใหม่', 'Chiang Mai'],
  ['ชลบุรี', 'Chonburi'],
  ['ขอนแก่น', 'Khon Kaen'],
  ['ต่างประเทศ', 'Overseas'],
  ['overseas', 'Overseas'],
  ['จีน', 'Overseas (China)'],
  ['china', 'Overseas (China)'],
];

export function normalizeProduct(p: any): any {
  const out = { ...p };
  out.name_clean = String(p.name ?? '').trim();
  out.category_normalized = normalizeCategory(String(p.name ?? ''), p.cat);
  out.brand_normalized = extractBrand(String(p.name ?? ''), p.shop_name);
  out.location_normalized = canonicalLocation(p.location);
  out.price_tier = priceTier(Number(p.price));
  out.velocity_bucket = velocityBucket(Number(p.monthly_sold), Number(p.historical_sold));
  out.age_bucket = ageBucket(p.listing_age_days);
  out.trust_bucket = trustBucket(Number(p.trust_score ?? p.t));
  out.completeness_score = computeCompleteness(p);
  return out;
}

function normalizeCategory(name: string, current?: string): string {
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(name)) return cat;
  }
  return current || 'Other';
}

function extractBrand(name: string, shopName?: string): string | null {
  const text = (name + ' ' + (shopName || '')).toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (text.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

function canonicalLocation(loc?: string): string {
  if (!loc) return 'Unknown';
  const l = loc.trim().toLowerCase();
  for (const [k, v] of LOCATION_MAP) {
    if (l.includes(k.toLowerCase())) return v;
  }
  return loc.trim();
}

function priceTier(price: number): string {
  if (!price || price <= 0) return 'Invalid';
  if (price < 100) return 'Budget';
  if (price < 500) return 'Cheap';
  if (price < 2000) return 'Mid';
  if (price < 10000) return 'Premium';
  return 'Luxury';
}

function velocityBucket(monthly: number, historical: number): string {
  const m = monthly || 0;
  const h = historical || 0;
  if (m === 0 && h === 0) return 'None';
  if (m === 0 && h > 500) return 'Legacy';
  const rate = h > 0 ? m / h : 1;
  if (rate > 0.5) return 'Fast';
  if (rate > 0.2) return 'Normal';
  if (rate > 0) return 'Slow';
  return 'New';
}

function ageBucket(days?: number | null): string {
  if (days == null) return 'Unknown';
  if (days < 30) return 'New (<1m)';
  if (days < 90) return 'Recent (<3m)';
  if (days < 180) return 'Established (<6m)';
  if (days < 365) return 'Mature (<1y)';
  return 'Old (>1y)';
}

function trustBucket(score: number): string {
  const s = score || 0;
  if (s >= 80) return 'Excellent';
  if (s >= 60) return 'Good';
  if (s >= 40) return 'Fair';
  return 'Poor';
}

function computeCompleteness(p: any): number {
  const fields = ['name', 'price', 'product_id', 'rating', 'review_count', 'monthly_sold', 'image', 'location'];
  const filled = fields.filter((f) => p[f] != null && p[f] !== '').length;
  return Math.round((filled / fields.length) * 100);
}