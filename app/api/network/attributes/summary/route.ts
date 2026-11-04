import { NextResponse } from 'next/server';
import { attributeCoverage } from '@/lib/network/attributes';
import { currentRecords } from '@/lib/network/current-records';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — coverage ต่อ attribute แยก evidence / ai / computed (อ่านจาก DB สด) */
export async function GET() {
  try {
    const { records, origin, label } = await currentRecords();
    return NextResponse.json({
      ok: true,
      origin,
      label,
      total: records.length,
      coverage: records.length ? attributeCoverage(records) : [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
