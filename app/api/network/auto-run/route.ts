import { NextRequest, NextResponse } from 'next/server';
import { aiStatus, autoEnabled, readAutoRun, scheduleAutoRun, runAutoRunOnce } from '@/lib/network/auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — สถานะ/ผลลัพธ์การประมวลผลอัตโนมัติล่าสุด (records ตัดเหลือ 12 แถว) + สถานะ AI
 *  `?slim=1` = ไม่ส่ง report/records/changes (ใช้กับการ์ดสถานะที่ poll ทุก 3 วินาที) */
export async function GET(req: NextRequest) {
  try {
    const slim = new URL(req.url).searchParams.get('slim') === '1';
    const view = await readAutoRun();
    let last = view.last
      ? { ...view.last, records: (view.last.records ?? []).slice(0, 12) }
      : null;
    if (slim && last) {
      const { records: _r, report_before: _b, report_after: _a, changes: _c, merged: _m, dropped: _d, ...rest } = last;
      last = { ...rest, records: [] } as unknown as typeof last;
    }
    return NextResponse.json({
      ok: true,
      enabled: autoEnabled(),
      status: view.status,
      stale: view.stale,
      last,
      ai: await aiStatus(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}

/** POST — สั่งประมวลผลใหม่ (background) ; body { wait?: true } เพื่อรอผลจริง */
export async function POST(req: NextRequest) {
  try {
    if (!autoEnabled()) {
      return NextResponse.json(
        { ok: false, error: 'AUTO_PIPELINE=0 — ปิดการประมวลผลอัตโนมัติอยู่' },
        { status: 409 },
      );
    }
    const body = await req.json().catch(() => ({}));
    if (body?.wait === true) {
      const file = await runAutoRunOnce({ kind: 'manual' });
      return NextResponse.json({
        ok: file.status === 'done',
        run: { ...file, records: (file.records ?? []).slice(0, 12) },
      });
    }
    const res = scheduleAutoRun({ kind: 'manual' });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
