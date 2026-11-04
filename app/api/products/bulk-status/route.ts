import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['pending', 'approved', 'rejected', 'archived']);

/**
 * POST /api/products/bulk-status — เปลี่ยนสถานะหลายรายการในคำขอเดียว
 * body: { ids: number[], status: 'approved' | 'rejected' | 'pending' | 'archived' }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
    const status = String(body?.status ?? '');

    if (!ids.length) return NextResponse.json({ ok: false, error: 'missing ids' }, { status: 400 });
    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { ok: false, error: `invalid status (allowed: ${[...ALLOWED].join(', ')})` },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('products')
      .update({ status, status_changed_at: new Date().toISOString() })
      .in('id', ids)
      .select('id,status');
    if (error) throw error;

    return NextResponse.json({ ok: true, status, updated: data?.length ?? 0, ids: (data ?? []).map((r) => r.id) });
  } catch (e: any) {
    console.error('[POST /api/products/bulk-status]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
