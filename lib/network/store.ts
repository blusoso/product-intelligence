import { promises as fs } from 'fs';
import path from 'path';
import type {
  NetworkSnapshot,
  Opportunity,
  OpportunityDiagnostics,
  PipelineResult,
} from './types';
import { pipelineSummary } from './pipeline';

const DIR = path.join(process.cwd(), 'data', 'network');
export const SNAPSHOT_FILE = path.join(DIR, 'graph.json');

// NOTE: snapshot version 1.2 เพิ่ม trust risk + datasource/internal tier (2026-11)

export interface SnapshotExtras {
  opportunities?: Opportunity[];
  diagnostics?: OpportunityDiagnostics;
}

export function snapshotFromResult(result: PipelineResult, extras: SnapshotExtras = {}): NetworkSnapshot {
  if (!result.graph) {
    throw new Error('snapshot ต้องมี graph — รัน pipeline ด้วย build_graph:true ก่อน');
  }
  const summary = pipelineSummary(result);
  return {
    meta: {
      generated_at: result.generated_at,
      source: result.source,
      version: '1.2',
      products: result.kept_count,
      nodes: summary.nodes,
      edges: summary.edges,
      quality_score: result.report_after.score,
      readiness: result.report_after.readiness,
    },
    graph: result.graph,
    report: result.report_after,
    records: result.products,
    dropped: result.dropped,
    merged: result.merged,
    changes: result.changes,
    ...(extras.opportunities ? { opportunities: extras.opportunities } : {}),
    ...(extras.diagnostics ? { diagnostics: extras.diagnostics } : {}),
  };
}

export async function saveSnapshot(snapshot: NetworkSnapshot): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot), 'utf8');
  await fs.writeFile(
    path.join(DIR, 'latest.json'),
    JSON.stringify(
      {
        ...snapshot.meta,
        saved_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
  return SNAPSHOT_FILE;
}

export async function readSnapshot(): Promise<NetworkSnapshot | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.graph) return null;
    return parsed as NetworkSnapshot;
  } catch {
    return null;
  }
}

export async function readLatestMeta(): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, 'latest.json'), 'utf8'));
  } catch {
    return null;
  }
}
