import type { Product } from './types';

export function guessCat(keyword: string): string {
  const k = String(keyword || '');
  if (/โต๊ะ|เก้าอี้|ชั้นวาง|โซฟา|เตียง|โคม|lamp|light/i.test(k)) return 'Home & Living';
  if (/หูฟัง|เคส|คอม|phone|gadget/i.test(k)) return 'Gadget';
  if (/ครีม|เซรั่ม|ลิป|serum|cream|lip/i.test(k)) return 'Beauty';
  if (/เสื้อ|กางเกง|กระเป๋า|tote|shirt|bag/i.test(k)) return 'Fashion';
  return 'Home & Living';
}

export function commissionFor(price: number): number {
  if (price < 700) return 2;
  if (price < 1000) return 3;
  if (price < 1500) return 4;
  if (price < 2500) return 5;
  if (price < 4000) return 6;
  return 8;
}

export function trustDots(t: number): number {
  return t >= 85 ? 5 : t >= 70 ? 4 : t >= 50 ? 3 : t >= 30 ? 2 : 1;
}

export type RawProduct = Omit<Product, 'id' | 'sku'>;

export function extractItems(body: any): { items: RawProduct[]; keyword: string; schema: string } {
  const schema = Array.isArray(body) ? 'simple'
    : body?.items && Array.isArray(body.items) ? 'scraper'
    : body?.products && Array.isArray(body.products) ? 'simple'
    : 'unknown';

  if (schema === 'unknown') return { items: [], keyword: '', schema };

  const arr: any[] = Array.isArray(body) ? body : schema === 'scraper' ? body.items : body.products;
  const keyword = body?.keyword || '';
  const defCat = guessCat(keyword);

  const items: any[] = arr.map((r, idx) => {
    const ext = schema === 'scraper'
      ? (r.shop_id ? `shopee:${r.shop_id}:${r.product_id}` : `shopee:${r.product_id}`)
      : (r.external_id || `unknown:${idx}`);
      
    const price = typeof r.price === 'number'
      ? r.price
      : parseFloat(String(r.price).replace(/[^0-9.]/g, '')) || 0;
      
    const cm = schema === 'scraper' ? commissionFor(price) : (r.commission_pct ?? 10);
    const t = schema === 'scraper' ? trustDots(Number(r.trust_score) || 70) : 4;

    // ✅ ข้อมูลพื้นฐาน
    const base = {
      ext,
      name: r.name || '',
      plat: (schema === 'scraper' ? 'shopee' : (r.platform || 'shopee')) as 'tiktok' | 'shopee',
      cat: schema === 'scraper' ? defCat : (r.category || defCat),
      price, cm, t,
      st: 'รอตรวจ' as const,
      up: 'จาก API',
      a: 'tote', g: idx % 4, rel: 0,
      sty: (r.styles || []).filter((s: string) => ['Cozy', 'Minimal', 'Budget'].includes(s)),
      au: (r.audiences || []).filter((s: string) => ['Renter', 'Student', 'Family', 'Budget'].includes(s)),
    };

    // ✅ ถ้าเป็นข้อมูลจาก Extension (Scraper) ให้เก็บข้อมูลดิบเพิ่มด้วย
    if (schema === 'scraper') {
      Object.assign(base, {
        product_id: r.product_id,
        shop_id: r.shop_id,
        shop_name: r.shop_name,
        rating: r.rating,
        review_count: r.review_count,
        monthly_sold: r.monthly_sold,
        historical_sold: r.historical_sold,
        trust_score: r.trust_score,
        trust_breakdown: r.trust_breakdown,
        listing_age_days: r.listing_age_days,
        is_ad: r.is_ad,
        shopee_verified: r.shopee_verified,
        image: r.image,
        images: r.images,
        location: r.location,
        specs: r.specs,
        options: r.options,
        pct_5star: r.pct_5star,
        red_flag_pct: r.red_flag_pct,
        rating_dist: r.rating_dist,
      });
    }

    return base;
  });

  return { items, keyword, schema };
}