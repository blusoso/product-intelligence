import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { toLegacyProduct } from '@/lib/product-row';

const ALLOWED = new Set(['pending', 'approved', 'rejected', 'archived']);

/**
 * POST — เปลี่ยนสถานะสินค้า
 * เดิม route นี้เขียนลง data/products.json (คนละที่กับตาราง products)
 * ตอนนี้เขียนลง DB ที่เดียว เพื่อไม่ให้มีสองแหล่งความจริง
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
    }

    const status = String(body?.status ?? '');
    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { ok: false, error: `invalid status (allowed: ${[...ALLOWED].join(', ')})` },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('products')
      .update({ status, status_changed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, product: toLegacyProduct(data) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
