import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { toLegacyProduct } from '@/lib/product-row';
import { buildReviewDetail, sanitizeEdits } from '@/lib/network/review';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/:id?include=raw
 *   → ข้อมูลเต็มของสินค้า 1 ชิ้น + attributes 18 ตัว + สรุปที่ใช้อนุมัติ
 *   raw = payload ดิบจาก raw_products (โหลดเมื่อขอเท่านั้น เพราะไฟล์ใหญ่)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const include = new URL(req.url).searchParams.get('include') ?? '';

    const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

    let raw: unknown = null;
    if (include.includes('raw') && data.ext) {
      const { data: rawRow } = await supabase
        .from('raw_products')
        .select('payload')
        .eq('ext', data.ext)
        .maybeSingle();
      raw = rawRow?.payload ?? null;
    }

    const detail = buildReviewDetail(data as Record<string, any>);
    // รีวิวดิบ 100 รายการไม่ช่วยตัดสินใจ แต่ทำให้ payload ใหญ่ — ตัดออก (โหลดได้จากแท็บข้อมูลดิบ)
    const { reviews: _reviews, ...product } = data as Record<string, any>;
    return NextResponse.json({
      ok: true,
      product: toLegacyProduct(product),
      ...detail,
      ...(include.includes('raw') ? { raw } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

const EDITABLE = [
  'name', 'sku', 'price', 'commission_per_unit', 'product_type',
  'brand', 'province', 'description', 'status',
] as const;

/**
 * PUT /api/products/:id
 * body: { name?, sku?, price?, commission_per_unit?, product_type?, brand?, province?, description?, status? }
 *
 * - เขียนเฉพาะคีย์ที่ค่าต่างจริง และบันทึกชื่อคีย์ลง manual_edits
 *   เพื่อให้ pipeline (auto-run / graph / backfill) ไม่เขียนทับของที่คนแก้
 * - ไม่แตะ last_ingested_at (เวลา ingest ไม่ใช่เวลาแก้)
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const { data: current, error: readError } = await supabase
      .from('products')
      .select(`id,${EDITABLE.join(',')},manual_edits,status_changed_at`)
      .eq('id', id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

    const { fields, changed, error } = sanitizeEdits(body, current as Record<string, any>);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    if (changed.length === 0) {
      return NextResponse.json({ ok: true, changed: [], product: toLegacyProduct(current) });
    }

    const now = new Date().toISOString();
    const manual = { ...((current as any).manual_edits ?? {}) };
    for (const key of changed) manual[key] = { at: now, by: 'admin' };

    const payload: Record<string, any> = { ...fields, manual_edits: manual };
    if (changed.includes('status')) payload.status_changed_at = now;

    const { data, error: writeError } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();
    if (writeError) throw writeError;

    return NextResponse.json({
      ok: true,
      changed,
      product: toLegacyProduct(data),
      ...buildReviewDetail(data as Record<string, any>),
    });
  } catch (e: any) {
    console.error('[PUT /api/products/:id]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
