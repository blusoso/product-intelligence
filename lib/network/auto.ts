/**
 * งานเบื้องหลังหลัง ingestion: normalize → enrichment → AI → canonical
 * → price history → audit → เขียนลง products
 *
 * ไม่สร้าง graph โดยเจตนา (graph เป็นขั้นที่ผู้ใช้สั่งเองในหน้า /network)
 * ทำงานแบบ coalesce: ถ้ามี ingest ซ้อนกันจะรวมเป็นรอบเดียว/rerun 1 ครั้ง
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { AuditReport, NormalizedProduct, PipelineConfig, SourceId, SyncMode } from './types';
import { DEFAULT_CONFIG, pipelineSummary, runPipeline } from './pipeline';
import { mergeConfig } from './config';
import { readStoredConfig, appendRun } from './persist';
import { loadProducts } from './source';
import { applyCoreFields, type SyncResult } from './apply';
import { auditNormalizedProducts } from './audit';
import { saveAuditRun } from './audit-store';
import { appendPriceObservations, attachPriceHistory } from './history';
import { aiAvailable, enrichWithAi, resolveAiConfig, type AiProgressEvent, type AiRunStats } from './ai';
import {
  enrichWithVision,
  needsVision,
  resolveVisionConfig,
  visionAvailable,
  visionStatus,
  type VisionProgressEvent,
  type VisionRunStats,
} from './vision';
import { enqueueConflicts, type EnqueueResult } from './conflicts';

const DIR = path.join(process.cwd(), 'data', 'network');
export const AUTO_FILE = path.join(DIR, 'auto-run.json');

const SETTLE_MS = 2000;
const STALE_MS = 10 * 60 * 1000;

export interface AutoTrigger {
  kind: 'ingest' | 'manual';
  received?: number;
}

export interface AutoRunFile {
  status: 'running' | 'done' | 'failed';
  started_at: string;
  finished_at: string | null;
  trigger: AutoTrigger;
  source: SourceId;
  label: string;
  note: string | null;
  summary: ReturnType<typeof pipelineSummary> | null;
  report_before: AuditReport | null;
  report_after: AuditReport | null;
  /** เก็บครบเพื่อให้ export ใช้ได้แม้ยังไม่สร้าง graph */
  records: NormalizedProduct[];
  dropped: unknown[];
  merged: unknown[];
  changes: unknown[];
  sync: SyncResult | null;
  ai: AiRunStats | null;
  /** สรุปผลการอ่านภาพ (ถ้าเปิดใช้) */
  vision: VisionRunStats | null;
  audit_id?: number | null;
  audit_saved?: boolean;
  config: PipelineConfig | null;
  error?: string;
}

export interface AutoRunView {
  status: 'idle' | 'running' | 'done' | 'failed';
  stale: boolean;
  last: AutoRunFile | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function autoEnabled(): boolean {
  return process.env.AUTO_PIPELINE !== '0';
}

/* ── สถานะ/ผลลัพธ์ ─────────────────────────────────────────── */

export async function readAutoRun(): Promise<AutoRunView> {
  try {
    const file = JSON.parse(await fs.readFile(AUTO_FILE, 'utf8')) as AutoRunFile;
    const stale =
      file.status === 'running' && Date.now() - new Date(file.started_at).getTime() > STALE_MS;
    return { status: file.status === 'running' && stale ? 'failed' : file.status, stale, last: file };
  } catch {
    return { status: 'idle', stale: false, last: null };
  }
}

async function writeAutoRun(file: AutoRunFile): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(AUTO_FILE, JSON.stringify(file), 'utf8');
}

export async function baseConfig(): Promise<PipelineConfig> {
  const stored = await readStoredConfig();
  const { updated_at: _ignored, ...rest } = stored ?? {};
  return mergeConfig(mergeConfig(DEFAULT_CONFIG, rest), { source: 'db' });
}

/* ── queue / coalesce ──────────────────────────────────────── */

let running = false;
let queued = false;
let queuedTrigger: AutoTrigger | null = null;

/**
 * เรียกจาก route handler หลังตอบ response แล้ว (next/server `after`)
 * คืนค่าทันทีเมื่อเริ่มรอบแรก — ไม่รอจนจบ
 */
export function scheduleAutoRun(trigger: AutoTrigger): { scheduled: boolean; reason?: string } {
  if (!autoEnabled()) return { scheduled: false, reason: 'AUTO_PIPELINE=0' };
  if (running) {
    queued = true;
    queuedTrigger = trigger;
    return { scheduled: true };
  }
  void runLoop(trigger);
  return { scheduled: true };
}

async function runLoop(first: AutoTrigger): Promise<void> {
  running = true;
  let trigger = first;
  try {
    for (;;) {
      queued = false;
      await sleep(SETTLE_MS); // รวม ingest ที่มาห่างกันไม่กี่วินาที
      await runAutoRunOnce(trigger);
      if (!queued) break;
      trigger = queuedTrigger ?? trigger;
    }
  } finally {
    running = false;
  }
}

/* ── ตัวงานจริง ────────────────────────────────────────────── */

export async function runAutoRunOnce(trigger: AutoTrigger): Promise<AutoRunFile> {
  const startedAt = new Date().toISOString();
  const base: AutoRunFile = {
    status: 'running',
    started_at: startedAt,
    finished_at: null,
    trigger,
    source: 'db',
    label: '',
    note: null,
    summary: null,
    report_before: null,
    report_after: null,
    records: [],
    dropped: [],
    merged: [],
    changes: [],
    sync: null,
    ai: null,
    vision: null,
    config: null,
  };
  await writeAutoRun(base).catch(() => undefined);

  try {
    const config = await baseConfig();
    const cfg: PipelineConfig = { ...config, source: 'db', build_graph: false };

    const loaded = await loadProducts('db');
    const resolvedSource: SourceId = loaded.source;

    const result = runPipeline(loaded.products, { ...cfg, source: resolvedSource, build_graph: false });

    // AI enrichment + พจนานุกรมวลี — ทำงานได้แม้ไม่มี AI key (วลีไม่ต้องใช้ API)
    let aiStats: AiRunStats | null = null;
    let visionStats: VisionRunStats | null = null;
    {
      const ai = await enrichWithAi(result.products, { config: cfg });
      aiStats = ai.stats;
      if (ai.stats.updated > 0) {
        // คำนวณ report ใหม่ให้ครอบคลุม AI coverage
        result.report_after = auditNormalizedProducts(
          result.products,
          `${resolvedSource} (network-ready)`,
          undefined,
          result.canonical,
        );
      }
    }

    // อ่านภาพ (ถ้าเปิดใช้) — ใช้ AI_API_KEY (DeepSeek) ได้เลย ไม่ต้องมี key แยก
    if (cfg.vision_enrich && visionAvailable(cfg)) {
      const vis = await enrichWithVision(result.products, { config: cfg });
      visionStats = vis.stats;
      if (vis.stats.updated > 0) {
        result.report_after = auditNormalizedProducts(
          result.products,
          `${resolvedSource} (network-ready)`,
          undefined,
          result.canonical,
        );
      }
    }

    // ส่งความขัดแย้งที่สำคัญเข้าคิวให้คนตรวจ (idempotent)
    await enqueueConflicts(result.products).catch(() => undefined);

    await appendPriceObservations(result.products, resolvedSource);
    await attachPriceHistory(result.products);

    const sync = await applyCoreFields(result.products, resolvedSource, 'both');

    const runId = crypto.randomUUID();
    const audit = await saveAuditRun({
      kind: 'auto',
      source: resolvedSource,
      run_id: runId,
      report_before: result.report_before,
      report_after: result.report_after,
      config: cfg,
      sync,
      ai: aiStats,
      graph_built: false,
    });

    const file: AutoRunFile = {
      status: 'done',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger,
      source: resolvedSource,
      label: loaded.label,
      note: loaded.note ?? null,
      summary: pipelineSummary(result),
      report_before: result.report_before,
      report_after: result.report_after,
      records: result.products,
      dropped: result.dropped.slice(0, 30),
      merged: result.merged.slice(0, 30),
      changes: result.changes.slice(0, 60),
      sync,
      ai: aiStats,
      vision: visionStats,
      audit_id: audit.ok ? audit.id ?? null : null,
      audit_saved: audit.ok,
      config: cfg,
    };
    await writeAutoRun(file);

    await appendRun({
      id: runId,
      at: new Date().toISOString(),
      source: resolvedSource,
      input: file.summary?.input ?? 0,
      kept: file.summary?.kept ?? 0,
      nodes: 0,
      edges: 0,
      readiness: result.report_after.readiness,
      score_before: result.report_before.score,
      score_after: result.report_after.score,
      elapsed_ms: result.elapsed_ms,
      snapshot: null,
      config: cfg,
      sync: sync.skipped
        ? null
        : { mode: 'both' as SyncMode, updated: sync.updated, failed: sync.failed },
      kind: 'auto',
      graph_built: false,
    }).catch(() => undefined);

    return file;
  } catch (e: any) {
    const failed: AutoRunFile = {
      ...base,
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: e?.message || String(e),
    };
    await writeAutoRun(failed).catch(() => undefined);
    console.error('[auto-run] failed:', e);
    return failed;
  }
}

/* ── backfill AI ให้สินค้าที่มีอยู่ ─────────────────────────── */

export interface AiBackfillResult {
  ok: boolean;
  error?: string;
  processed: number;
  remaining: number;
  stats?: AiRunStats;
  /** สรุปการอ่านภาพ (เฉพาะเมื่อขอ phase 'vision'/'all') */
  vision?: VisionRunStats;
  /** ผลการส่งความขัดแย้งเข้าคิว */
  conflicts?: EnqueueResult;
  sync?: SyncResult;
  audit_id?: number | null;
  /** true เมื่อผู้ใช้กดยกเลิกกลางทาง (ผลที่ได้ยังถูกบันทึก) */
  stopped?: boolean;
}

export type AiBackfillStage = 'loading' | 'prepare' | 'sync' | 'audit' | 'vision';

/** ขั้นตอนที่ขอให้ทำงาน: ข้อความ / ภาพ / ทั้งคู่ */
export type BackfillPhase = 'text' | 'vision' | 'all';

/** อีเวนต์ที่ส่งให้ UI ระหว่างเติม AI (สตรีมเป็น NDJSON) */
export type AiBackfillEvent =
  | { type: 'stage'; stage: AiBackfillStage; label: string; total?: number }
  | ({ type: 'progress' } & AiProgressEvent)
  | { type: 'vision_progress'; progress: VisionProgressEvent }
  | { type: 'done'; result: AiBackfillResult }
  | { type: 'error'; error: string };

/** นับแถวที่ยังไม่มี ai_enrichment (ใช้ทั้ง API และ UI) */
async function countAiRows(q: (b: any) => any): Promise<number> {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { count, error } = await q(supabase.from('products').select('id', { count: 'exact', head: true }));
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** แถวที่ยังไม่เคยเรียก AI */
export const countNullAi = () => countAiRows((b) => b.is('ai_enrichment', null));
/** แถวที่เคยเรียกแล้วแต่ล้มเหลว (ยังไม่มี tags) — ต้องกดเติมซ้ำได้ */
export const countFailedAi = () => countAiRows((b) => b.eq('ai_enrichment->meta->>status', 'error'));

/** แถวที่ยังต้องเติม AI = ยังไม่มี + เรียกแล้วล้มเหลว */
export async function countMissingAi(): Promise<number> {
  const [nulls, failed] = await Promise.all([countNullAi(), countFailedAi()]);
  return nulls + failed;
}

export async function runAiBackfill(
  opts: {
    limit?: number;
    budgetMs?: number;
    /** เรียกซ้ำทุกแถว (ไม่สนว่ามี ai_enrichment แล้วหรือยัง) */
    force?: boolean;
    /** 'text' | 'vision' | 'all' (ค่าเริ่มต้น all) */
    phase?: BackfillPhase;
    /** สตรีมความคืบหน้าให้ UI */
    onEvent?: (e: AiBackfillEvent) => void;
    /** true = ผู้ใช้ยกเลิก — หยุดหลัง batch ที่กำลังทำอยู่ แต่ยังบันทึกผลที่ได้ */
    shouldStop?: () => boolean;
  } = {},
): Promise<AiBackfillResult> {
  const emit = (e: AiBackfillEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      /* client ปิดไปแล้ว — ทำงานต่อให้จบ */
    }
  };

  const phase: BackfillPhase = opts.phase === 'vision' || opts.phase === 'text' ? opts.phase : 'all';
  const wantsText = phase !== 'vision';
  const wantsVision = phase !== 'text';
  const aiReady = aiAvailable();
  const visionReady = visionAvailable();

  if (wantsText && !aiReady && !(wantsVision && visionReady)) {
    return {
      ok: false,
      error: 'AI ปิดอยู่ — ตั้ง AI_API_KEY (และ AI_ENRICH ไม่ใช่ 0) แล้ว restart dev server',
      processed: 0,
      remaining: await countMissingAi(),
    };
  }
  if (!wantsText && !visionReady) {
    return {
      ok: false,
      error: 'การอ่านภาพปิดอยู่ — ตั้ง AI_API_KEY (DeepSeek) หรือ VISION_API_KEY แล้ว restart dev server',
      processed: 0,
      remaining: 0,
    };
  }

  const config = await baseConfig();
  emit({ type: 'stage', stage: 'loading', label: 'โหลดสินค้าจากฐานข้อมูล…' });
  const loaded = await loadProducts('db');
  if (loaded.source !== 'db' || loaded.products.length === 0) {
    return { ok: false, error: 'ตาราง products ว่างหรือเชื่อมต่อไม่ได้', processed: 0, remaining: 0 };
  }

  emit({ type: 'stage', stage: 'prepare', label: 'normalize + rule enrichment…', total: loaded.products.length });
  const result = runPipeline(loaded.products, { ...config, source: 'db', build_graph: false });
  const fresh = result.products;
  // force = เรียกซ้ำทุกแถว — จัดการภายใน enrichWithAi (ไม่ล้างแท็กเดิมทิ้ง
  // เพราะถ้าล้างแล้วแถวที่ยังไม่ถึงคิวจะเสียข้อมูลที่เคยสกัดไว้)

  const updated = new Set<string>();
  let aiStats: AiRunStats | undefined;

  if (wantsText && aiReady) {
    const desired = Math.max(1, Math.min(5000, opts.limit ?? config.ai_max_records_per_run));
    const ai = await enrichWithAi(fresh, {
      config: { ...config, ai_max_records_per_run: desired },
      budgetMs: opts.budgetMs ?? 90000,
      force: opts.force === true,
      onProgress: (p: AiProgressEvent) => emit({ type: 'progress', ...p }),
      shouldStop: opts.shouldStop,
    });
    aiStats = ai.stats;
    for (const key of ai.updatedKeys) updated.add(key);
  }

  let visionStats: VisionRunStats | undefined;
  if (wantsVision && visionReady) {
    emit({ type: 'stage', stage: 'vision', label: 'อ่านรูปภาพด้วย VLM…', total: fresh.length });
    const desiredVision = Math.max(
      1,
      Math.min(200, opts.limit ?? config.vision_max_records_per_run),
    );
    const vis = await enrichWithVision(fresh, {
      config: { ...config, vision_max_records_per_run: desiredVision },
      budgetMs: opts.budgetMs ?? 90000,
      force: opts.force === true,
      onProgress: (progress: VisionProgressEvent) => emit({ type: 'vision_progress', progress }),
      shouldStop: opts.shouldStop,
    });
    visionStats = vis.stats;
    for (const key of vis.updatedKeys) updated.add(key);
  }

  const touched = fresh.filter((p) => p.node_key && updated.has(p.node_key));
  const stopped = Boolean(opts.shouldStop?.());

  // ความขัดแย้งที่สำคัญ → คิวให้คนตรวจ (ทำหลังรวมผลทุกชั้นแล้ว)
  const conflicts = touched.length ? await enqueueConflicts(fresh).catch(() => undefined) : undefined;

  if (touched.length) {
    emit({ type: 'stage', stage: 'sync', label: `เขียน ai_enrichment กลับฐานข้อมูล ${touched.length} แถว…` });
  }
  const sync = touched.length ? await applyCoreFields(touched, 'db', 'normalized') : undefined;

  const remaining = wantsText
    ? await countMissingAi()
    : fresh.filter((p) => needsVision(p, resolveVisionConfig())).length;

  // รีเฟรชรายงาน/auto-run ให้สะท้อน AI ที่เพิ่งเติม (รอบนี้จะไม่เรียก AI ซ้ำเพราะแถวมี ai แล้ว)
  let auditId: number | null = null;
  if (touched.length) {
    emit({ type: 'stage', stage: 'audit', label: 'อัปเดต audit และรายงาน…' });
    const refreshed = await runAutoRunOnce({ kind: 'manual' });
    auditId = refreshed.audit_id ?? null;
  }

  return {
    ok: true,
    processed: touched.length,
    remaining,
    ...(aiStats ? { stats: aiStats } : {}),
    ...(visionStats ? { vision: visionStats } : {}),
    ...(conflicts ? { conflicts } : {}),
    sync,
    audit_id: auditId,
    stopped,
  };
}

/** AI status สำหรับ UI: พร้อม/ปิด + โมเดล + จำนวนแถวที่ยังขาด (+ สถานะการอ่านภาพ) */
export async function aiStatus(): Promise<{
  available: boolean;
  provider: string;
  model: string;
  thinking: boolean;
  missing: number;
  failed: number;
  vision: {
    available: boolean;
    provider: string;
    model: string;
    detail: string;
    max_per_run: number;
  };
}> {
  const cfg = resolveAiConfig();
  const [nulls, failed] = await Promise.all([countNullAi(), countFailedAi()]);
  const vis = visionStatus();
  return {
    available: aiAvailable(),
    provider: cfg.provider,
    model: cfg.model,
    thinking: cfg.thinking,
    missing: nulls + failed,
    failed,
    vision: {
      available: vis.available,
      provider: vis.provider,
      model: vis.model,
      detail: vis.detail,
      max_per_run: vis.max_per_run,
    },
  };
}
