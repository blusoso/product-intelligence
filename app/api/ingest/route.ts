import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { extractItems } from '@/lib/ingest-mapper';
import { initialProducts } from '@/lib/data';
import { cleanProduct } from '@/lib/data-quality/clean';
import { normalizeProduct } from '@/lib/data-quality/normalize';

const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const LOG_FILE = path.join(process.cwd(), 'data', 'ingest-log.json');

// ─── Auth (optional — เปิดโดยการใส่ env PI_INGEST_API_KEY) ───
function checkApiKey(req: NextRequest): NextResponse | null {
  const expected = process.env.PI_INGEST_API_KEY;
  if (!expected) {
    return null; // dev mode — ไม่มี env = ไม่ตรวจ
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

async function readProducts(): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
  } catch {
    return [...initialProducts];
  }
}

async function writeProducts(products: any[]) {
  await fs.mkdir(path.dirname(PRODUCTS_FILE), { recursive: true });
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
}

async function readLog(): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeLog(logEntries: any[]) {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify(logEntries, null, 2), 'utf8');
}

// ═══════════════════════════════════════════════════════════════
// POST /api/ingest — รับข้อมูลจาก extension
// ═══════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const authErr = checkApiKey(req);
  if (authErr) return authErr;

  try {
    const body = await req.json();
    const { items, keyword, schema } = extractItems(body);

    if (!items.length) {
      return NextResponse.json(
        { ok: false, error: `no items extracted (schema: ${schema})` },
        { status: 400 }
      );
    }

    const existing = await readProducts();
    const existingExts = new Map(existing.map((p) => [p.ext, p]));
    const now = new Date().toISOString();

    // ─── แยก toAdd / toUpdate ───
    const toAdd = items.filter((p) => !existingExts.has(p.ext));
    const toUpdate = items.filter((p) => existingExts.has(p.ext));

    // ─── สร้าง id ให้ของใหม่ + ใส่ status ───
    let nextId = Math.max(0, ...existing.map((p) => Number(p.id) || 0)) + 1;
    const addedWithIds = toAdd.map((p, idx) => {
      const id = nextId++;
      const { cleaned } = cleanProduct(p, idx);
      const normalized = normalizeProduct(cleaned);
      return {
        ...normalized,
        _raw: p, // 👈 เก็บข้อมูลดิบไว้ใน property _raw
        id,
        sku: `SKU-${1000 + id}`,
        status: 'pending',
        status_changed_at: now,
        ingested_at: now,
      };
    });

    let merged = [...existing];
    for (const p of toUpdate) {
      const idx = merged.findIndex((x) => x.ext === p.ext);
      if (idx >= 0) {
        const { cleaned } = cleanProduct(p, idx);
        const normalized = normalizeProduct(cleaned);
        merged[idx] = {
          ...merged[idx],
          ...normalized,
          _raw: p, // 👈 อัปเดตข้อมูลดิบด้วย
          id: merged[idx].id,
          sku: merged[idx].sku,
          status: merged[idx].status ?? 'pending',
          status_changed_at: merged[idx].status_changed_at ?? now,
          ingested_at: merged[idx].ingested_at ?? now,
          last_ingested_at: now,
        };
      }
    }

    merged = [...addedWithIds, ...merged];

    await writeProducts(merged);

    // ✅ ทำ Source ให้อ่านง่าย
    const makeSourceLabel = () => {
      const rawSrc = String(body.source || '');
      const kw = keyword || body.keyword || 'N/A';

      // 1) ถ้า Extension ส่งมาเป็น "Shopee | Market | keyword" แล้ว ให้ใช้เลย
      if (rawSrc.includes('|')) return rawSrc;

      // 2) ถ้าเป็น Captcha
      if (rawSrc.includes('captcha') || rawSrc.includes('verify')) {
        return 'Shopee | Captcha/Block | N/A';
      }
      
      // 3) ถ้าเป็น URL หรือข้อมูลเก่า ให้เดาจากบริบท
      if (rawSrc.includes('overview')) return `Shopee | Overview | ${kw}`;
      if (rawSrc.includes('gems')) return `Shopee | Gems | ${kw}`;
      
      // 4) Default ให้เป็น Market
      return `Shopee | Market | ${kw}`;
    };

    const logEntries = await readLog();
    logEntries.unshift({
      at: now,
      source: makeSourceLabel(),
      keyword: keyword || null,
      added: addedWithIds.length,
      updated: toUpdate.length,
      received: items.length,
    });
    await writeLog(logEntries.slice(0, 100));

    const pending = merged.filter((p) => p.status === 'pending').length;

    return NextResponse.json({
      ok: true,
      received: items.length,
      added: addedWithIds.length,
      updated: toUpdate.length,
      total: merged.length,
      pending,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/ingest — คืน log + stats (สำหรับ dashboard)
// ═══════════════════════════════════════════════════════════════
export async function GET() {
  const logEntries = await readLog();
  const products = await readProducts();

  const pending = products.filter((p: any) => p.status === 'pending').length;
  const approved = products.filter((p: any) => p.status === 'approved').length;
  const rejected = products.filter((p: any) => p.status === 'rejected').length;

  return NextResponse.json({
    count: logEntries.length,
    log: logEntries,
    stats: {
      total: products.length,
      pending,
      approved,
      rejected,
    },
  });
}