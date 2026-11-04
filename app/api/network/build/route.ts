import { NextRequest, NextResponse } from 'next/server';
import { loadProducts } from '@/lib/network/source';
import { DEFAULT_CONFIG, pipelineSummary, runPipeline } from '@/lib/network/pipeline';
import { mergeConfig } from '@/lib/network/config';
import { appendRun, readStoredConfig } from '@/lib/network/persist';
import { saveSnapshot, snapshotFromResult } from '@/lib/network/store';
import { appendPriceObservations, attachPriceHistory, saveSnapshotCopy } from '@/lib/network/history';
import { applyCoreFields } from '@/lib/network/apply';
import { saveAuditRun } from '@/lib/network/audit-store';
import { annotateOpportunities, computeOpportunities } from '@/lib/network/opportunity';
import type { NetworkRun, SyncMode } from '@/lib/network/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function syncModeFrom(body: Record<string, any>): SyncMode | null {
  if (body.syncMode === 'core' || body.syncMode === 'normalized' || body.syncMode === 'both') {
    return body.syncMode;
  }
  if (body.sync_db === true) return 'core';
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;

    // ลำดับความสำคัญ: ค่าที่บันทึกไว้ → ค่าที่ส่งมากับ request
    const stored = await readStoredConfig();
    const { updated_at: _ignored, ...storedConfig } = stored ?? {};
    const config = mergeConfig(mergeConfig(DEFAULT_CONFIG, storedConfig), body);

    const sourceParam = config.source === 'file' ? 'file' : 'db';
    const loaded = await loadProducts(sourceParam);
    const resolvedSource = config.source === 'file' ? 'file' : loaded.source;

    const result = runPipeline(loaded.products, { ...config, source: resolvedSource, build_graph: true });

    // ประวัติราคา: บันทึกเฉพาะเมื่อราคาเปลี่ยน แล้วติดสรุปลง record
    const priceHistory = await appendPriceObservations(result.products, resolvedSource);
    await attachPriceHistory(result.products);

    // Proven / Hidden / Emerging — ต้องมี graph ก่อน (deterministic ล้วน)
    const opportunityReport = result.graph
      ? computeOpportunities(result.products, result.graph)
      : null;
    if (opportunityReport) annotateOpportunities(result.products, opportunityReport);

    const runId = crypto.randomUUID();
    let snapshotPath: string | null = null;
    let snapshotCopy: string | null = null;
    if (body.apply !== false) {
      const snapshot = snapshotFromResult(result, {
        opportunities: opportunityReport?.items,
        diagnostics: opportunityReport?.diagnostics,
      });
      // เขียนซ้ำตรงนี้ด้วย เพื่อกัน dev cache ที่ยังถือ store.ts เวอร์ชันเก่า
      if (opportunityReport) {
        snapshot.opportunities = opportunityReport.items;
        snapshot.diagnostics = opportunityReport.diagnostics;
      }
      snapshotPath = await saveSnapshot(snapshot);
      snapshotCopy = await saveSnapshotCopy(runId, snapshot).catch(() => null);
    }

    const syncMode = syncModeFrom(body);
    const sync = syncMode ? await applyCoreFields(result.products, resolvedSource, syncMode) : null;

    // เก็บ audit ลง DB (ประวัติ) — ไม่ทำให้ build ล้มถ้า DB มีปัญหา
    const audit = await saveAuditRun({
      kind: 'graph',
      source: resolvedSource,
      run_id: runId,
      report_before: result.report_before,
      report_after: result.report_after,
      projection: result.report_after.projection ?? null,
      config: result.config,
      sync,
      graph_built: true,
    });

    const summary = pipelineSummary(result);
    const run: NetworkRun = {
      id: runId,
      at: new Date().toISOString(),
      source: resolvedSource,
      input: summary.input,
      kept: summary.kept,
      nodes: summary.nodes,
      edges: summary.edges,
      readiness: summary.readiness,
      score_before: summary.score_before,
      score_after: summary.score_after,
      elapsed_ms: summary.elapsed_ms,
      snapshot: snapshotPath,
      config: result.config,
      sync: sync ? { mode: syncMode as SyncMode, updated: sync.updated, failed: sync.failed } : null,
      kind: 'graph' as const,
      graph_built: true,
    };
    await appendRun(run);

    return NextResponse.json({
      ok: true,
      applied: body.apply !== false,
      snapshot: snapshotPath,
      snapshot_copy: snapshotCopy,
      history: { prices_added: priceHistory.appended, prices_error: priceHistory.error ?? null },
      run,
      source: resolvedSource,
      label: loaded.label,
      note: loaded.note ?? null,
      summary,
      report_before: result.report_before,
      report_after: result.report_after,
      dropped: result.dropped,
      merged: result.merged,
      changes: result.changes.slice(0, 200),
      records: result.products.slice(0, 60),
      opportunities: {
        counts: opportunityReport?.class_counts ?? null,
        gate: opportunityReport?.gate_counts ?? summary.gate,
        risk: opportunityReport?.diagnostics.risk_counts ?? summary.risk,
        diagnostics: opportunityReport?.diagnostics ?? null,
      },
      sync,
      audit_id: audit.ok ? audit.id ?? null : null,
      audit_saved: audit.ok,
      config: result.config,
    });
  } catch (e: any) {
    console.error('[network/build]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
