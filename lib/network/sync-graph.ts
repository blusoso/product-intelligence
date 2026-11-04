/**
 * เขียน graph snapshot ลง Supabase (network_runs / network_nodes / network_edges)
 * -----------------------------------------------------------------------------
 * เก็บเป็น "ชุดล่าสุด" ชุดเดียว: insert run ใหม่ → ลบ run เก่า (cascade) → insert nodes/edges
 * เหตุผล: PK ของ network_nodes/network_edges เป็น id เดี่ยว (ไม่ใช่ composite)
 * จึงเก็บหลายรอบพร้อมกันไม่ได้โดยไม่ชนกัน
 */
import type { NetworkSnapshot } from './types';

const CHUNK = 500;

export interface GraphSyncResult {
  ok: boolean;
  run_id: number | null;
  nodes: number;
  edges: number;
  error?: string;
  hint?: string;
}

async function insertChunks(
  table: 'network_nodes' | 'network_edges',
  rows: Array<Record<string, any>>,
): Promise<string | null> {
  const { supabase } = await import('@/lib/supabase');
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK));
    if (error) return error.message;
  }
  return null;
}

export async function syncGraphToDb(snapshot: NetworkSnapshot): Promise<GraphSyncResult> {
  const result: GraphSyncResult = { ok: false, run_id: null, nodes: 0, edges: 0 };
  try {
    const { supabase } = await import('@/lib/supabase');
    const stats = snapshot.graph.stats;

    const { data: runRow, error: runError } = await supabase
      .from('network_runs')
      .insert({
        generated_at: snapshot.meta.generated_at,
        source: snapshot.meta.source,
        input_count: snapshot.meta.products,
        kept_count: snapshot.meta.products,
        node_count: snapshot.graph.nodes.length,
        edge_count: snapshot.graph.edges.length,
        quality_score: snapshot.meta.quality_score,
        readiness: snapshot.meta.readiness,
        summary: {
          readiness_breakdown: stats.readiness_breakdown,
          by_node_type: stats.by_node_type,
          by_edge_type: stats.by_edge_type,
          isolates: stats.isolates.length,
          components: stats.components,
          gate: stats.by_gate_status ?? null,
          risk: stats.by_risk_level ?? null,
          opportunity_counts: (snapshot.opportunities ?? []).reduce<Record<string, number>>((acc, o) => {
            acc[o.class] = (acc[o.class] ?? 0) + 1;
            return acc;
          }, {}),
        },
      })
      .select('id')
      .single();

    if (runError || !runRow) {
      return {
        ...result,
        error: runError?.message ?? 'insert network_runs ไม่สำเร็จ',
        hint: 'ตรวจว่าได้ apply migration 20261103120000_network_graph.sql แล้ว',
      };
    }

    const runId = Number(runRow.id);
    result.run_id = runId;

    // ลบชุดเก่า (cascade ไปที่ nodes/edges) — เก็บเฉพาะชุดล่าสุด
    const { error: cleanupError } = await supabase
      .from('network_runs')
      .delete()
      .neq('id', runId);
    if (cleanupError) {
      return { ...result, error: `ลบชุดเก่าไม่สำเร็จ: ${cleanupError.message}` };
    }

    const nodeRows = snapshot.graph.nodes.map((n) => ({
      id: n.id,
      run_id: runId,
      type: n.type,
      label: n.label,
      weight: n.weight,
      attributes: n.attributes ?? {},
    }));
    const edgeRows = snapshot.graph.edges.map((e) => ({
      id: e.id,
      run_id: runId,
      type: e.type,
      source: e.source,
      target: e.target,
      weight: e.weight,
      directed: e.directed,
      evidence: e.evidence ?? {},
    }));

    const nodeError = await insertChunks('network_nodes', nodeRows);
    if (nodeError) return { ...result, error: `insert network_nodes: ${nodeError}` };
    const edgeError = await insertChunks('network_edges', edgeRows);
    if (edgeError) return { ...result, error: `insert network_edges: ${edgeError}` };

    return { ...result, ok: true, nodes: nodeRows.length, edges: edgeRows.length };
  } catch (e: any) {
    return { ...result, error: e?.message ?? String(e) };
  }
}
