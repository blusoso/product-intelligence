import { NextRequest, NextResponse } from 'next/server';
import { loadProducts } from '@/lib/network/source';
import { pipelineSummary, runPipeline } from '@/lib/network/pipeline';
import { saveAuditRun } from '@/lib/network/audit-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET — ตรวจคุณภาพแบบเร็ว (ไม่สร้าง graph)
 * readiness ที่ได้จึงเป็นค่าประมาณจาก coverage ไม่ใช่ connectivity
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const sourceParam = url.searchParams.get('source');
    const loaded = await loadProducts(sourceParam === 'file' ? 'file' : 'db');

    const result = runPipeline(loaded.products, {
      source: loaded.source,
      build_graph: false,
    });
    const preview = Math.min(Math.max(Number(url.searchParams.get('preview') ?? 12), 0), 50);

    // บันทึกเฉพาะเมื่อขอ (?save=1) — dry-run ปกติไม่สร้างขยะใน DB
    let auditId: number | null = null;
    if (url.searchParams.get('save') === '1') {
      const audit = await saveAuditRun({
        kind: 'manual',
        source: loaded.source,
        report_before: result.report_before,
        report_after: result.report_after,
        config: result.config,
        graph_built: false,
      });
      auditId = audit.ok ? audit.id ?? null : null;
    }

    return NextResponse.json({
      ok: true,
      source: loaded.source,
      label: loaded.label,
      note: loaded.note ?? null,
      summary: pipelineSummary(result),
      graph_built: false,
      audit_id: auditId,
      report_before: result.report_before,
      report_after: result.report_after,
      dropped: result.dropped.slice(0, 30),
      merged: result.merged.slice(0, 30),
      changes: result.changes.slice(0, 40),
      records: result.products.slice(0, preview),
      projection: null,
      config: result.config,
    });
  } catch (e: any) {
    console.error('[network/audit]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
