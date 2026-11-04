import { NextRequest, NextResponse } from 'next/server';
import { buildProductAttributes } from '@/lib/network/attributes';
import { currentRecords } from '@/lib/network/current-records';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/network/attributes?ext=...&limit=... */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const ext = url.searchParams.get('ext');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 5), 1), 50);
    const { records, origin, label } = await currentRecords();
    if (!records.length) {
      return NextResponse.json({ ok: false, error: 'ยังไม่มีข้อมูล — รอ ingestion หรือกดประมวลผลใหม่' }, { status: 404 });
    }

    if (ext) {
      const p = records.find((r) => String(r.ext) === ext);
      if (!p) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
      return NextResponse.json({
        ok: true,
        origin,
        label,
        ext: p.ext,
        name: p.name,
        attributes: buildProductAttributes(p),
        ai_meta: p.ai?.meta ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      origin,
      label,
      count: Math.min(limit, records.length),
      total: records.length,
      items: records.slice(0, limit).map((p) => ({
        ext: p.ext,
        name: p.name,
        attributes: buildProductAttributes(p),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
