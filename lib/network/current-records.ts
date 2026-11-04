/**
 * แหล่ง records ล่าสุดสำหรับ attributes API/export
 * - ถ้าตาราง products มีข้อมูล: normalize สดจาก DB (เห็นค่าที่เพิ่งเขียนทันที)
 * - ถ้า DB ว่าง: ใช้ records จาก auto-run.json / snapshot (โหมดไฟล์)
 */
import type { NormalizedProduct } from './types';
import { loadProducts } from './source';
import { runPipeline } from './pipeline';
import { readAutoRun } from './auto';
import { readSnapshot } from './store';

export interface CurrentRecords {
  records: NormalizedProduct[];
  origin: 'db' | 'cache';
  label: string;
}

export async function currentRecords(): Promise<CurrentRecords> {
  try {
    const loaded = await loadProducts('db');
    if (loaded.source === 'db' && loaded.products.length) {
      const result = runPipeline(loaded.products, { source: 'db', build_graph: false });
      return { records: result.products, origin: 'db', label: loaded.label };
    }
  } catch {
    /* ตกไปใช้ cache */
  }

  const auto = await readAutoRun();
  if (auto.last?.records?.length) {
    return { records: auto.last.records, origin: 'cache', label: auto.last.label };
  }
  const snapshot = await readSnapshot();
  return {
    records: (snapshot?.records as NormalizedProduct[]) ?? [],
    origin: 'cache',
    label: snapshot ? 'snapshot' : '',
  };
}
