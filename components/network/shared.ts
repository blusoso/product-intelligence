import type { CSSProperties } from 'react';
import type {
  AuditReport,
  CleanChange,
  DroppedRecord,
  GraphEdge,
  GraphNode,
  MergeRecord,
  NetworkRun,
  NetworkSnapshot,
  NetworkStats,
  NormalizedProduct,
  PipelineConfig,
  SourceId,
  SyncMode,
} from '@/lib/network/types';

export type { AuditReport, CleanChange, DroppedRecord, GraphEdge, GraphNode, MergeRecord, NormalizedProduct, PipelineConfig, SyncMode };

export type StepId = 1 | 2 | 3 | 4 | 5;
export type Source = SourceId;

export const nf = new Intl.NumberFormat('th-TH');

/** `.tr` ใช้ grid-template-columns จาก CSS var `--c` */
export const cols = (template: string) => ({ ['--c']: template } as unknown as CSSProperties);

export const scoreColor = (s: number) =>
  s >= 80 ? 'var(--ok)' : s >= 60 ? 'var(--ambT)' : 'var(--bad)';

export const sevColor = (s: string) =>
  s === 'critical' ? 'var(--bad)' : s === 'warning' ? 'var(--ambT)' : 'var(--mute)';

export const sevIcon = (s: string) => (s === 'critical' ? '🚨' : s === 'warning' ? '⚠️' : 'ℹ️');

export function verdict(score: number): { label: string; tone: string; hint: string } {
  if (score >= 85) {
    return { label: 'พร้อมใช้', tone: 'var(--ok)', hint: 'ข้อมูลนิ่งแล้ว ใช้สร้างกราฟได้เลย' };
  }
  if (score >= 70) {
    return { label: 'ควรแก้ก่อน', tone: 'var(--ambT)', hint: 'ยังใช้ได้ แต่ควรเก็บปัญหาด้านล่างก่อน' };
  }
  return { label: 'ยังใช้ไม่ได้', tone: 'var(--bad)', hint: 'ปัญหาสำคัญยังเยอะ ให้แก้ที่ต้นทางก่อน' };
}

export function short(s: string, n = 54) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export interface AuditSummary {
  source: Source;
  input: number;
  kept: number;
  dropped: number;
  merged: number;
  changes: number;
  nodes: number;
  edges: number;
  isolates: number;
  components: number;
  score_before: number;
  score_after: number;
  readiness: number;
  elapsed_ms: number;
  graph_built?: boolean;
  canonical_groups?: number;
  enrich_nodes?: number;
  ai_nodes?: number;
  /** แถวที่ยังไม่มีค่าจากการอ่านภาพ */
  vision_missing?: number;
  /** จำนวนค่าที่มาจากพจนานุกรมวลี */
  phrase_values?: number;
  /** จำนวนค่าที่ AI ขัดกับหลักฐานและรอคนตรวจ */
  conflict_pending?: number;
}

export interface AiRunStatsView {
  enabled: boolean;
  provider?: string;
  model: string;
  thinking?: boolean;
  requested: number;
  cached: number;
  called: number;
  batches: number;
  updated: number;
  failed: number;
  invalid: number;
  skipped: number;
  second_pass?: number;
  retries?: number;
  empty_responses?: number;
  phrase_hits?: number;
  phrase_misses?: number;
  gated?: number;
  focus_pass?: number;
  vision_called?: number;
  vision_cached?: number;
  vision_failed?: number;
  vision_fetch_failed?: number;
  conflicts_enqueued?: number;
  tokens?: { prompt: number; completion: number; cached: number };
  cost_usd?: number;
  error?: string;
}

export interface VisionRunStatsView {
  enabled: boolean;
  provider?: string;
  model: string;
  requested: number;
  cached: number;
  called: number;
  updated: number;
  failed: number;
  fetch_failed?: number;
  invalid?: number;
  skipped?: number;
  tags?: number;
  tokens?: { prompt: number; completion: number };
  cost_usd?: number;
  error?: string;
}

export interface AiStatusView {
  available: boolean;
  provider: string;
  model: string;
  thinking: boolean;
  /** ยังต้องเติม AI (ยังไม่มี + เรียกแล้วล้มเหลว) */
  missing: number;
  /** จำนวนแถวที่เคยเรียกแล้วล้มเหลว */
  failed?: number;
  vision?: {
    available: boolean;
    provider: string;
    model: string;
    detail: string;
    max_per_run: number;
  };
}

export type AiBackfillStage = 'loading' | 'prepare' | 'sync' | 'audit' | 'vision';

export interface VisionProgressView {
  done: number;
  total: number;
  called: number;
  cached: number;
  failed: number;
  images: number;
  tags: number;
  elapsed_ms: number;
}

export interface AiBackfillResultView {
  ok: boolean;
  error?: string;
  processed: number;
  remaining: number;
  audit_id?: number | null;
  stopped?: boolean;
  stats?: AiRunStatsView;
  vision?: VisionRunStatsView;
}

/** อีเวนต์ที่ route สตรีมกลับมา (NDJSON) ระหว่างเติม AI */
export type AiBackfillEventView =
  | { type: 'stage'; stage: AiBackfillStage; label: string; total?: number }
  | {
      type: 'progress';
      phase: 'calling' | 'second_pass' | 'focus' | 'vision';
      done: number;
      total: number;
      batches_done: number;
      batches_total: number;
      called: number;
      cached: number;
      failed: number;
      tokens: { prompt: number; completion: number; cached: number };
      cost_usd: number;
      elapsed_ms: number;
      focus_total?: number;
      focus_done?: number;
    }
  | { type: 'vision_progress'; progress: VisionProgressView }
  | { type: 'done'; result: AiBackfillResultView }
  | { type: 'error'; error: string };

export interface AttributeCoverageRow {
  attribute: string;
  label: string;
  total: number;
  evidence: number;
  ai: number;
  computed: number;
  /** จำนวนสินค้าที่ admin แก้ค่านั้นเอง */
  manual?: number;
  none: number;
}

export interface AuditRunRow {
  id: number;
  at: string;
  run_id: string | null;
  kind: 'auto' | 'graph' | 'ai-backfill' | 'manual';
  source: string;
  total: number;
  score: number;
  grade: string;
  readiness: number;
  score_before: number | null;
  readiness_before: number | null;
  summary: { critical: number; warning: number; info: number } | null;
  graph_built: boolean;
}

export interface AutoRunFileView {
  status: 'running' | 'done' | 'failed';
  started_at: string;
  finished_at: string | null;
  trigger: { kind: 'ingest' | 'manual'; received?: number };
  source: Source;
  label: string;
  note: string | null;
  summary: AuditSummary | null;
  report_before: AuditReport | null;
  report_after: AuditReport | null;
  records: NormalizedProduct[];
  dropped: DroppedRecord[];
  merged: MergeRecord[];
  changes: CleanChange[];
  sync: SyncInfo | null;
  ai: AiRunStatsView | null;
  vision?: VisionRunStatsView | null;
  config: PipelineConfig | null;
  error?: string;
}

export interface AutoRunPayload {
  ok: boolean;
  error?: string;
  enabled: boolean;
  status: 'idle' | 'running' | 'done' | 'failed';
  stale: boolean;
  last: AutoRunFileView | null;
  ai?: AiStatusView;
}

export interface SyncInfo {
  attempted: number;
  updated: number;
  failed: number;
  skipped: boolean;
  mode: SyncMode | null;
  note?: string;
  hint?: string;
  errors: { ext: string; error: string }[];
}

export interface AuditPayload {
  ok: boolean;
  error?: string;
  source: Source;
  label: string;
  note: string | null;
  summary: AuditSummary;
  report_before: AuditReport;
  report_after: AuditReport;
  dropped: DroppedRecord[];
  merged: MergeRecord[];
  changes: CleanChange[];
  records: NormalizedProduct[];
  projection?: unknown | null;
  graph_built?: boolean;
}

export interface BuildPayload extends AuditPayload {
  applied: boolean;
  snapshot: string | null;
  run: NetworkRun;
  sync: SyncInfo | null;
}

export interface GraphPayload {
  ok: boolean;
  error?: string;
  meta: NetworkSnapshot['meta'];
  stats: NetworkStats;
  report: AuditReport;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface RunDelta {
  readiness: number;
  edges: number;
  nodes: number;
  score_after: number;
  products: number;
}

export type RunWithDelta = NetworkRun & { delta: RunDelta | null };

export interface ConfigPreset {
  id: 'default' | 'strict' | 'loose';
  label: string;
  description: string;
  config: PipelineConfig;
}

export interface ConfigPayload {
  ok: boolean;
  config: PipelineConfig;
  defaults: PipelineConfig;
  presets: ConfigPreset[];
  updated_at: string | null;
}

export const TH_DATETIME = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
};
