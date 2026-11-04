import { NextResponse } from 'next/server';
import { readSnapshot } from '@/lib/network/store';
import { syncGraphToDb } from '@/lib/network/sync-graph';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST — เขียน graph snapshot ล่าสุดลง Supabase (network_runs/nodes/edges) */
export async function POST() {
  try {
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: 'ยังไม่มี graph snapshot — กด "สร้างกราฟและบันทึก" ก่อน' },
        { status: 409 },
      );
    }
    const result = await syncGraphToDb(snapshot);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e: any) {
    console.error('[network/sync-graph]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
