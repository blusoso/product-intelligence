import { promises as fs } from 'fs';
import path from 'path';
import type { NetworkRun, PipelineConfig } from './types';

/**
 * ไฟล์ persistence ของ pipeline (แยกจาก snapshot)
 * - config.json : ค่าที่ผู้ใช้บันทึกไว้
 * - runs.jsonl  : ประวัติการรัน (เก็บ 50 ล่าสุด)
 * แยกไฟล์ออกมาเพื่อไม่ให้ store.ts (snapshot) ต้องรับผิดชอบหลายเรื่อง
 */

const DIR = path.join(process.cwd(), 'data', 'network');
export const CONFIG_FILE = path.join(DIR, 'config.json');
export const RUNS_FILE = path.join(DIR, 'runs.jsonl');

const MAX_RUNS = 50;

export type StoredConfig = Partial<PipelineConfig> & { updated_at?: string };

export async function readStoredConfig(): Promise<StoredConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as StoredConfig;
  } catch {
    return null;
  }
}

export async function writeStoredConfig(config: PipelineConfig): Promise<StoredConfig> {
  const payload: StoredConfig = { ...config, updated_at: new Date().toISOString() };
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/** ต่อท้ายประวัติการรัน แล้วเก็บไว้แค่ MAX_RUNS บรรทัดล่าสุด */
export async function appendRun(run: NetworkRun): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  let lines: string[] = [];
  try {
    lines = (await fs.readFile(RUNS_FILE, 'utf8'))
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
  } catch {
    lines = [];
  }
  lines.push(JSON.stringify(run));
  await fs.writeFile(RUNS_FILE, `${lines.slice(-MAX_RUNS).join('\n')}\n`, 'utf8');
}

/** ประวัติล่าสุดก่อน (newest first) */
export async function readRuns(limit = 20): Promise<NetworkRun[]> {
  try {
    const lines = (await fs.readFile(RUNS_FILE, 'utf8'))
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const runs: NetworkRun[] = [];
    for (const line of lines.slice(-MAX_RUNS)) {
      try {
        runs.push(JSON.parse(line) as NetworkRun);
      } catch {
        // ข้ามบรรทัดที่พัง ไม่ให้ประวัติทั้งไฟล์ใช้ไม่ได้
      }
    }
    return runs.reverse().slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
