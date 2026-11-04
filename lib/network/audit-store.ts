/**
 * เก็บ Audit ลง DB (ประวัติ) — ไม่ทำให้ pipeline ล้มถ้า DB มีปัญหา
 * ตาราง: network_audit_runs (+ view network_audit_findings)
 */
import type { AiRunStats } from './ai';
import type { AuditReport, DimensionScore, PipelineConfig } from './types';
import type { SyncResult } from './apply';

export type AuditKind = 'auto' | 'graph' | 'ai-backfill' | 'manual';

export interface SaveAuditInput {
  kind: AuditKind;
  source: string;
  run_id?: string | null;
  report_before: AuditReport;
  report_after: AuditReport;
  projection?: Record<string, any> | null;
  config?: Partial<PipelineConfig> | null;
  sync?: SyncResult | null;
  ai?: AiRunStats | null;
  graph_built?: boolean;
}

export interface AuditRunRow {
  id: number;
  at: string;
  run_id: string | null;
  kind: AuditKind;
  source: string;
  total: number;
  score: number;
  grade: string;
  readiness: number;
  score_before: number | null;
  readiness_before: number | null;
  summary: AuditReport['summary'] | null;
  dimensions: DimensionScore[] | null;
  report_before?: AuditReport | null;
  report_after?: AuditReport | null;
  projection?: Record<string, any> | null;
  config?: Record<string, any> | null;
  sync?: Record<string, any> | null;
  ai?: Record<string, any> | null;
  graph_built: boolean;
}

const MAX_ROWS = 200;

/** insert แล้ว prune เหลือ MAX_ROWS — คืน error แทนการ throw */
export async function saveAuditRun(
  input: SaveAuditInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const after = input.report_after;
    const before = input.report_before;
    const { data, error } = await supabase
      .from('network_audit_runs')
      .insert({
        run_id: input.run_id ?? null,
        kind: input.kind,
        source: input.source,
        total: after.total,
        score: after.score,
        grade: after.grade,
        readiness: after.readiness,
        score_before: before?.score ?? null,
        readiness_before: before?.readiness ?? null,
        summary: after.summary,
        dimensions: after.dimensions,
        report_before: before,
        report_after: after,
        projection: input.projection ?? after.projection ?? null,
        config: input.config ?? null,
        sync: input.sync ?? null,
        ai: input.ai ?? null,
        graph_built: input.graph_built ?? Boolean(after.projection),
      })
      .select('id')
      .single();
    if (error) {
      console.error('[audit-store] insert failed:', error.message);
      return { ok: false, error: error.message };
    }
    await pruneAuditRuns().catch(() => undefined);
    return { ok: true, id: Number(data?.id) };
  } catch (e: any) {
    console.error('[audit-store] save error:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** เก็บแถวล่าสุด MAX_ROWS (best-effort) */
export async function pruneAuditRuns(keep = MAX_ROWS): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase
      .from('network_audit_runs')
      .select('id')
      .order('at', { ascending: false })
      .range(keep, keep + 500);
    const ids = (data ?? []).map((r: any) => r.id);
    if (!ids.length) return;
    await supabase.from('network_audit_runs').delete().in('id', ids);
  } catch {
    /* prune ล้มเหลวไม่เป็นไร */
  }
}

export async function readAuditRuns(opts: {
  limit?: number;
  kind?: AuditKind | null;
  full?: boolean;
} = {}): Promise<{ ok: boolean; rows: AuditRunRow[]; error?: string }> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const base = [
      'id',
      'at',
      'run_id',
      'kind',
      'source',
      'total',
      'score',
      'grade',
      'readiness',
      'score_before',
      'readiness_before',
      'summary',
      'dimensions',
      'projection',
      'sync',
      'ai',
      'graph_built',
    ];
    const columns = opts.full ? [...base, 'report_before', 'report_after'] : base;
    let q = supabase
      .from('network_audit_runs')
      .select(columns.join(','))
      .order('at', { ascending: false })
      .limit(limit);
    if (opts.kind) q = q.eq('kind', opts.kind);
    const { data, error } = await q;
    if (error) {
      console.error('[audit-store] read failed:', error.message);
      return { ok: false, rows: [], error: error.message };
    }
    return { ok: true, rows: (data ?? []) as unknown as AuditRunRow[] };
  } catch (e: any) {
    return { ok: false, rows: [], error: e?.message || String(e) };
  }
}
