import { NextRequest, NextResponse } from 'next/server';
import { conflictCounts, loadConflicts, type ConflictStatus } from '@/lib/network/conflicts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES: Array<ConflictStatus | 'all'> = ['pending', 'resolved_rule', 'resolved_ai', 'dismissed', 'all'];

/** เติมชื่อสินค้า (และ id) ให้แถว conflict เพื่อให้ UI อ่านรู้เรื่อง — best-effort */
async function withNames(rows: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
  const exts = [...new Set(rows.map((r) => String(r.ext ?? '')).filter(Boolean))].slice(0, 200);
  if (!exts.length) return rows;
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase.from('products').select('id,ext,name').in('ext', exts);
    const map = new Map<string, { id: number; name: string }>();
    for (const row of data ?? []) {
      map.set(String((row as any).ext), { id: Number((row as any).id), name: String((row as any).name ?? '') });
    }
    return rows.map((r) => {
      const hit = map.get(String(r.ext));
      return hit ? { ...r, product_id: hit.id, name: hit.name } : r;
    });
  } catch {
    return rows;
  }
}

/**
 * GET /api/network/conflicts?status=pending&limit=100
 * คิวให้คนตรวจ: ค่าที่ AI ขัดกับหลักฐาน (rule ยังเป็นตัวจริงจนกว่าคนจะตัดสิน)
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const rawStatus = url.searchParams.get('status') ?? 'pending';
    const status = STATUSES.includes(rawStatus as any) ? (rawStatus as ConflictStatus | 'all') : 'pending';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500);

    const [{ rows, store }, counts] = await Promise.all([
      loadConflicts({ status, limit }),
      conflictCounts(),
    ]);
    return NextResponse.json({
      ok: true,
      status,
      store,
      counts,
      rows: await withNames(rows as unknown as Array<Record<string, any>>),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
