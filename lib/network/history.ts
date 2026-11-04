/**
 * ประวัติข้อมูล (append-only) — raw payload และราคา
 * ---------------------------------------------------
 * เหตุผล: การ upsert ทับทำให้ "เห็นครั้งแรกเมื่อไร เปลี่ยนอะไรไปบ้าง" หายไป
 * ไฟล์อยู่ใน data/network/ (gitignored) — ไม่ต้องมี migration ก็ใช้งานได้
 * ข้อจำกัดที่รู้ตัว: เขียนแบบ read-modify-write ไม่มี lock (ข้อมูลระดับพันแถว ยอมรับได้)
 */
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import type { NormalizedProduct, PriceHistorySummary } from './types';

const DIR = path.join(process.cwd(), 'data', 'network');
export const RAW_HISTORY_FILE = path.join(DIR, 'raw-history.jsonl');
export const PRICE_HISTORY_FILE = path.join(DIR, 'price-history.jsonl');
export const SNAPSHOT_DIR = path.join(DIR, 'snapshots');

/** เก็บ payload ดิบกี่เวอร์ชันต่อ listing */
const MAX_VERSIONS_PER_EXT = 5;
export const MAX_SNAPSHOT_FILES = 10;

export interface AppendResult {
  appended: number;
  skipped: number;
  error?: string;
}

export interface PriceObservation {
  ext: string;
  at: string;
  price: number;
  price_before_discount: number | null;
  monthly_sold: number;
  source: string;
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashPayload(payload: any): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function extOf(raw: any): string {
  const explicit = String(raw?.ext ?? '').trim();
  if (explicit) return explicit;
  const plat = String(raw?.plat ?? raw?.platform ?? 'shopee').trim().toLowerCase() || 'shopee';
  return `${plat}:${String(raw?.shop_id ?? '').trim()}:${String(raw?.product_id ?? '').trim()}`;
}

async function readJsonl(file: string): Promise<any[]> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text) return [];
  const out: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // บรรทัดเสีย (เขียนค้าง) → ข้าม ไม่ทำให้ทั้งไฟล์ใช้ไม่ได้
    }
  }
  return out;
}

async function writeJsonl(file: string, rows: any[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  await fs.writeFile(tmp, body ? `${body}\n` : '', 'utf8');
  await fs.rename(tmp, file);
}

interface RawVersion {
  ext: string;
  hash: string;
  seen_at: string;
  payload: any;
}

/**
 * บันทึก payload ดิบเฉพาะเมื่อ "เนื้อหาเปลี่ยน" — ซ้ำไม่กินพื้นที่
 * เก็บย้อนหลังได้ MAX_VERSIONS_PER_EXT เวอร์ชันต่อ listing
 */
export async function appendRawHistory(items: any[], seenAt = new Date().toISOString()): Promise<AppendResult> {
  try {
    const existing = (await readJsonl(RAW_HISTORY_FILE)) as RawVersion[];
    const lastByExt = new Map<string, string>();
    const countByExt = new Map<string, number>();
    for (const row of existing) {
      if (!row?.ext) continue;
      lastByExt.set(row.ext, row.hash);
      countByExt.set(row.ext, (countByExt.get(row.ext) ?? 0) + 1);
    }

    const appendedRows: RawVersion[] = [];
    let skipped = 0;
    for (const item of items) {
      const ext = extOf(item);
      const hash = hashPayload(item);
      if (lastByExt.get(ext) === hash) {
        skipped++;
        continue;
      }
      appendedRows.push({ ext, hash, seen_at: seenAt, payload: item });
      lastByExt.set(ext, hash);
      countByExt.set(ext, (countByExt.get(ext) ?? 0) + 1);
    }

    if (!appendedRows.length) return { appended: 0, skipped };

    const all = [...existing, ...appendedRows];
    // ตัดเวอร์ชันเก่าเกินกำหนด (นับจากท้ายไฟล์ = ใหม่สุด)
    const kept: RawVersion[] = [];
    const seen = new Map<string, number>();
    for (let i = all.length - 1; i >= 0; i--) {
      const row = all[i];
      if (!row?.ext) continue;
      const n = seen.get(row.ext) ?? 0;
      if (n >= MAX_VERSIONS_PER_EXT) continue;
      seen.set(row.ext, n + 1);
      kept.push(row);
    }
    kept.reverse();
    await writeJsonl(RAW_HISTORY_FILE, kept);
    return { appended: appendedRows.length, skipped };
  } catch (e: any) {
    return { appended: 0, skipped: 0, error: e?.message || String(e) };
  }
}

/** บันทึกราคาเมื่อ "ราคาเปลี่ยน" เท่านั้น (หรือยังไม่เคยมี) */
export async function appendPriceObservations(
  products: NormalizedProduct[],
  source: string,
  at = new Date().toISOString(),
): Promise<AppendResult> {
  try {
    const existing = (await readJsonl(PRICE_HISTORY_FILE)) as PriceObservation[];
    const last = new Map<string, PriceObservation>();
    for (const row of existing) if (row?.ext) last.set(row.ext, row);

    const rows: PriceObservation[] = [];
    let skipped = 0;
    for (const p of products) {
      if (!p.ext || !(p.price > 0)) {
        skipped++;
        continue;
      }
      const prev = last.get(p.ext);
      if (prev && prev.price === p.price && prev.price_before_discount === p.price_before_discount) {
        skipped++;
        continue;
      }
      rows.push({
        ext: p.ext,
        at,
        price: p.price,
        price_before_discount: p.price_before_discount,
        monthly_sold: p.monthly_sold,
        source,
      });
    }

    if (!rows.length) return { appended: 0, skipped };
    await writeJsonl(PRICE_HISTORY_FILE, [...existing, ...rows]);
    return { appended: rows.length, skipped };
  } catch (e: any) {
    return { appended: 0, skipped: 0, error: e?.message || String(e) };
  }
}

/** สรุปประวัติราคาต่อ listing (ใช้ตอน build) */
export async function priceSummaries(): Promise<Map<string, PriceHistorySummary>> {
  const rows = (await readJsonl(PRICE_HISTORY_FILE)) as PriceObservation[];
  const byExt = new Map<string, PriceObservation[]>();
  for (const row of rows) {
    if (!row?.ext || !(row.price > 0)) continue;
    const list = byExt.get(row.ext) ?? [];
    list.push(row);
    byExt.set(row.ext, list);
  }

  const out = new Map<string, PriceHistorySummary>();
  for (const [ext, list] of byExt) {
    const prices = list.map((r) => r.price);
    const last = list[list.length - 1];
    const prev = list.length > 1 ? list[list.length - 2] : null;
    out.set(ext, {
      observations: list.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      last_change_pct: prev && prev.price > 0 ? Math.round(((last.price - prev.price) / prev.price) * 1000) / 10 : null,
      last_observed_at: last.at,
    });
  }
  return out;
}

/** ติดสรุปประวัติราคาลง record (ถ้าไม่มีประวัติ → null) */
export async function attachPriceHistory(products: NormalizedProduct[]): Promise<number> {
  const summaries = await priceSummaries();
  let attached = 0;
  for (const p of products) {
    const summary = summaries.get(p.ext);
    p.price_history = summary ?? null;
    if (summary) attached++;
  }
  return attached;
}

/** สำเนา snapshot ต่อการรัน + prune ให้เหลือ MAX_SNAPSHOT_FILES */
export async function saveSnapshotCopy(runId: string, snapshot: any): Promise<string> {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const safe = runId.replace(/[^\w-]+/g, '-').slice(0, 60);
  const file = path.join(SNAPSHOT_DIR, `${safe}.json`);
  await fs.writeFile(file, JSON.stringify(snapshot), 'utf8');
  await pruneSnapshots();
  return file;
}

async function pruneSnapshots(keep = MAX_SNAPSHOT_FILES): Promise<void> {
  const entries = await fs.readdir(SNAPSHOT_DIR).catch(() => [] as string[]);
  const files = entries.filter((f) => f.endsWith('.json'));
  if (files.length <= keep) return;
  const stats = await Promise.all(
    files.map(async (f) => {
      const p = path.join(SNAPSHOT_DIR, f);
      const s = await fs.stat(p).catch(() => null);
      return { p, mtime: s?.mtimeMs ?? 0 };
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  for (const { p } of stats.slice(keep)) {
    await fs.unlink(p).catch(() => undefined);
  }
}

/** สำหรับ UI/ตรวจสอบ: เวอร์ชันดิบของ listing หนึ่ง */
export async function readRawHistory(ext: string, limit = 5): Promise<RawVersion[]> {
  const rows = (await readJsonl(RAW_HISTORY_FILE)) as RawVersion[];
  return rows.filter((r) => r.ext === ext).slice(-Math.max(1, limit));
}

export async function readPriceHistory(ext: string, limit = 50): Promise<PriceObservation[]> {
  const rows = (await readJsonl(PRICE_HISTORY_FILE)) as PriceObservation[];
  return rows.filter((r) => r.ext === ext).slice(-Math.max(1, limit));
}
