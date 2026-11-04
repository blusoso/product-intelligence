import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { toLegacyProduct, toDbColumns } from '@/lib/product-row';
import { buildReviewDetail } from '@/lib/network/review';

/** คอลัมน์ที่หน้ารายการ/คิวต้องใช้ — ตัด reviews/options/description ออกเพื่อให้ payload เล็ก */
const LIST_COLUMNS = [
  'id', 'ext', 'product_id', 'shop_id', 'shop_name', 'sku', 'name', 'plat', 'url', 'image',
  'price', 'price_before_discount', 'discount_pct', 'commission_per_unit',
  'monthly_sold', 'historical_sold', 'rating', 'review_count', 'trust_score', 'tier',
  'liked_count', 'shopee_verified', 'is_ad', 'listing_age_days', 'in_stock', 'total_stock',
  'status', 'status_changed_at', 'ingested_at', 'last_ingested_at',
  'brand', 'product_type', 'province', 'region', 'category_confidence',
  'quality_score', 'quality_flags', 'network_node_key', 'currency',
  'width_cm', 'depth_cm', 'height_cm', 'size_label', 'canonical_id', 'listing_count',
  'enrichment', 'ai_enrichment', 'attribute_overrides', 'manual_edits',
].join(',');

const STATUSES = ['pending', 'approved', 'rejected', 'archived'] as const;

/**
 * GET /api/products
 *   ?view=list (ค่าเริ่มต้น) | full
 *   ?status=pending|approved|rejected|archived|all
 *   ?q=คำค้น &limit=100 &offset=0
 *
 * view=list: คอลัมน์ที่จำเป็น + badges ที่คำนวณแล้ว (ไม่ส่ง enrichment ดิบ)
 * view=full: เหมือนเดิม (select *) — ใช้เมื่อต้องการทุกฟิลด์จริง ๆ
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const view = url.searchParams.get('view') === 'full' ? 'full' : 'list';
    const status = url.searchParams.get('status') ?? 'all';
    const q = (url.searchParams.get('q') ?? '').trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0);

    if (view === 'full') {
      const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false });
      if (error) throw error;
      const products = (data || []).map((row) => toLegacyProduct(row));
      return NextResponse.json({ ok: true, view, products, count: products.length });
    }

    let query = supabase.from('products').select(LIST_COLUMNS, { count: 'exact' });
    if (status !== 'all' && (STATUSES as readonly string[]).includes(status)) {
      query = query.eq('status', status);
    }
    if (q) {
      const needle = q.replace(/[%,]/g, ' ').trim();
      if (needle) query = query.or(`name.ilike.%${needle}%,sku.ilike.%${needle}%,shop_name.ilike.%${needle}%`);
    }

    const { data, error, count } = await query
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const products = (data || []).map((row) => {
      const detail = buildReviewDetail(row as Record<string, any>);
      const legacy = toLegacyProduct(row as Record<string, any>);
      // ไม่ส่ง enrichment/ai_enrichment ดิบลง client — ส่งเฉพาะตัวเลขที่ UI ใช้
      const { enrichment: _e, ai_enrichment: _a, attribute_overrides: _o, ...rest } = legacy;
      return { ...rest, badges: detail.counts, has_overrides: Boolean(_o) };
    });

    // จำนวนต่อแท็บ (นับจาก DB จริง ไม่ใช่จากหน้าปัจจุบัน)
    const head = (s?: string) => {
      let q2 = supabase.from('products').select('id', { count: 'exact', head: true });
      if (s) q2 = q2.eq('status', s);
      return q2;
    };
    const [all, pending, approved, rejected, archived] = await Promise.all([
      head(), head('pending'), head('approved'), head('rejected'), head('archived'),
    ]);
    const counts = {
      all: all.count ?? 0,
      pending: pending.count ?? 0,
      approved: approved.count ?? 0,
      rejected: rejected.count ?? 0,
      archived: archived.count ?? 0,
    };

    return NextResponse.json({
      ok: true,
      view,
      products,
      count: products.length,
      total: count ?? products.length,
      counts,
    });
  } catch (e: any) {
    console.error('[GET /api/products]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST — เพิ่มสินค้าใหม่ (สำหรับปุ่ม "+ เพิ่มสินค้า" ใน Modal)
// ═══════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  try {
    const body = toDbColumns(await req.json());
    const now = new Date().toISOString();

    const record = {
      ext: body.ext || `manual:${Date.now()}`,
      name: body.name || 'สินค้าใหม่',
      price: Number(body.price) || 0,
      product_type: body.product_type || null,
      plat: body.plat || 'shopee',
      commission_per_unit: Number(body.commission_per_unit) || 0,
      trust_score: Number(body.trust_score) || 0,
      status: body.status || 'pending',
      sku: body.sku || `SKU-${Date.now()}`,
      ingested_at: now,
    };

    const { data, error } = await supabase
      .from('products')
      .insert(record)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, product: toLegacyProduct(data) });
  } catch (e: any) {
    console.error('[POST /api/products]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════
// PUT — อัปเดตสินค้า (bulk update)
// body: { ids: [...], ...fields }
// ═══════════════════════════════════════════════════════════════
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const now = new Date().toISOString();

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ ok: false, error: 'missing ids (ใช้ PUT /api/products/:id สำหรับแถวเดียว)' }, { status: 400 });
    }
    const fields = toDbColumns(body);
    delete fields.ids;

    const { data, error } = await supabase
      .from('products')
      .update({ ...fields, last_ingested_at: now })
      .in('id', body.ids)
      .select();

    if (error) throw error;
    const products = (data || []).map((row) => toLegacyProduct(row));
    return NextResponse.json({ ok: true, updated: products.length, products });
  } catch (e: any) {
    console.error('[PUT /api/products]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════
// DELETE — ลบสินค้า (เดี่ยวหรือหลายรายการ)
// ═══════════════════════════════════════════════════════════════
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', body.ids);
      if (error) throw error;
      return NextResponse.json({ ok: true, deleted: body.ids.length });
    }

    if (!body.id) {
      return NextResponse.json({ ok: false, error: 'missing id' }, { status: 400 });
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e: any) {
    console.error('[DELETE /api/products]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
