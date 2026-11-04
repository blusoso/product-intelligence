import { NextRequest, NextResponse } from 'next/server';
import { readAuditRuns, type AuditKind } from '@/lib/network/audit-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS: AuditKind[] = ['auto', 'graph', 'ai-backfill', 'manual'];

/** GET — ประวัติ audit ที่เก็บใน DB (light โดยปริยาย) */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 100);
    const rawKind = url.searchParams.get('kind');
    const kind = rawKind && KINDS.includes(rawKind as AuditKind) ? (rawKind as AuditKind) : null;
    const full = url.searchParams.get('full') === '1';

    const res = await readAuditRuns({ limit, kind, full });
    return NextResponse.json({
      ok: res.ok,
      count: res.rows.length,
      rows: res.rows,
      ...(res.error ? { error: res.error, hint: 'ยังไม่ได้ apply migration 20261103142100_audit_and_attributes.sql' } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
