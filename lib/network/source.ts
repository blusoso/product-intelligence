import { promises as fs } from 'fs';
import path from 'path';
import type { SourceId } from './types';

const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const PAGE = 1000;

export interface LoadedProducts {
  products: any[];
  source: SourceId;
  label: string;
  note?: string;
}

export function flattenRow(row: any, rawPayload?: any): any {
  const raw = rawPayload && typeof rawPayload === 'object'
    ? rawPayload
    : (row && typeof row._raw === 'object' && row._raw ? row._raw : {});
  // DB row ชนะ payload — แต่เฉพาะเมื่อ "มีค่า" จริง
  // (คอลัมน์ที่เพิ่งเพิ่มและยังเป็น null ต้องไม่กลบข้อความจริงจาก payload)
  const merged: any = { ...raw };
  for (const [key, value] of Object.entries(row ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    merged[key] = value;
  }
  delete merged._raw;
  return merged;
}

/**
 * payload ดิบไม่ได้ถูกเก็บซ้ำใน products แล้ว (migration dedupe)
 * จึงดึงจาก raw_products ตาม ext — ใช้เป็นหลักฐานของ cat/location ฯลฯ
 */
async function loadRawPayloads(exts: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (exts.length === 0) return map;
  const { supabase } = await import('@/lib/supabase');
  const BATCH = 100;
  for (let i = 0; i < exts.length; i += BATCH) {
    const { data, error } = await supabase
      .from('raw_products')
      .select('ext,payload')
      .in('ext', exts.slice(i, i + BATCH));
    if (error) continue; // payload เป็นข้อมูลเสริม — ไม่ทำให้ pipeline ล้ม
    for (const row of data ?? []) {
      if (row?.payload) map.set(String(row.ext), row.payload);
    }
  }
  return map;
}

async function loadFromDatabase(): Promise<LoadedProducts> {
  const { supabase } = await import('@/lib/supabase');
  const rows: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase products: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const payloads = await loadRawPayloads(rows.map((r) => String(r.ext ?? '')).filter(Boolean));
  const all = rows.map((row) => flattenRow(row, payloads.get(String(row.ext))));
  return { products: all, source: 'db', label: `Supabase products (${all.length})` };
}

async function loadFromFile(): Promise<LoadedProducts> {
  const raw = await fs.readFile(PRODUCTS_FILE, 'utf8').catch(() => '[]');
  const parsed = JSON.parse(raw);
  const products = Array.isArray(parsed) ? parsed.map((row: any) => flattenRow(row)) : [];
  return { products, source: 'file', label: `data/products.json (${products.length})` };
}

/**
 * โหลดข้อมูลดิบจากแหล่งที่เลือก
 * - db: Supabase ตาราง products (แหล่งจริงของแอป)
 * - file: data/products.json (fallback / dev)
 */
export async function loadProducts(source: SourceId = 'db'): Promise<LoadedProducts> {
  if (source === 'file') return loadFromFile();
  try {
    const loaded = await loadFromDatabase();
    if (loaded.products.length > 0) return loaded;
    const file = await loadFromFile();
    return { ...file, source: 'file', note: 'ตาราง products ว่าง — ใช้ไฟล์ JSON แทน' };
  } catch (e: any) {
    const file = await loadFromFile();
    return {
      ...file,
      source: 'file',
      note: `เชื่อมต่อ Supabase ไม่ได้ (${e.message}) — ใช้ไฟล์ JSON แทน`,
    };
  }
}

export async function readFileProducts(): Promise<any[]> {
  return (await loadFromFile()).products;
}
