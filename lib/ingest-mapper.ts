export function mapToDatabase(r: any) {
  // จัดการเรื่องรูปภาพ
  const coverImage = (r.images_all && r.images_all.length > 0)
    ? r.images_all[0]
    : (r.cover_image || r.image || null);

  return {
    // Core
    ext: `shopee:${r.shop_id}:${r.product_id}`,
    product_id: String(r.product_id),
    shop_id: String(r.shop_id),
    shop_name: r.shop_name || '',
    name: r.name || '',
    plat: r.platform || 'shopee',
    url: r.url || '',

    // ราคา & คอม
    price: Number(r.price) || 0,
    price_before_discount: r.price_before_discount ? Number(r.price_before_discount) : null,
    discount_pct: r.discount_pct || null,
    commission_per_unit: r.commission_per_unit || 0,

    // ยอดขาย & รีวิว
    monthly_sold: r.monthly_sold || 0,
    historical_sold: r.historical_sold || 0,
    rating: r.rating || null,
    review_count: r.review_count || 0,
    trust_score: r.trust_score || 0,
    tier: r.tier || 'UNKNOWN',
    liked_count: r.liked_count || 0,

    // สถานะร้าน & สินค้า (จังหวัด/หมวดหมู่ตั้งโดย /api/network/build)
    shopee_verified: !!r.shopee_verified,
    is_ad: !!r.is_ad,
    listing_age_days: r.listing_age_days || null,
    seller_flag: r.seller_flag || null,
    voucher_code: r.voucher_code || null,
    in_stock: r.in_stock === true,
    total_stock: r.total_stock || null,
    enriched: !!r.enriched,

    // JSONB Fields
    rating_dist: r.rating_dist || {},
    trust_breakdown: r.trust_breakdown || {},
    options: r.options || [],
    images_all: r.images_all || [],
    specs: r.specs || [],
    tier_variations: r.tier_variations || [],
    reviews: r.reviews || [],

    // ค่าเริ่มต้นของ Admin
    image: coverImage,
    description: String(r.description ?? '').slice(0, 4000) || null,
    status: 'pending',
    ingested_at: new Date().toISOString(),
  };
}
