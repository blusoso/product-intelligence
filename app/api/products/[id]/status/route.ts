import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const ALLOWED = new Set(['pending', 'approved', 'rejected', 'archived']);

async function readProducts(): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeProducts(products: any[]) {
  await fs.mkdir(path.dirname(PRODUCTS_FILE), { recursive: true });
  await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2), 'utf8');
}

// รองรับทั้ง Next.js 14 (sync params) และ 15 (Promise params)
type ParamsInput = { params: { id: string } | Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: ParamsInput) {
  const p = params instanceof Promise ? await params : params;
  const id = p.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const { status } = body || {};
  if (!ALLOWED.has(status)) {
    return NextResponse.json(
      { ok: false, error: `invalid status (allowed: ${[...ALLOWED].join(', ')})` },
      { status: 400 },
    );
  }

  const products = await readProducts();
  const idx = products.findIndex((x) => String(x.id) === String(id));
  if (idx < 0) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  products[idx].status = status;
  products[idx].status_changed_at = new Date().toISOString();
  await writeProducts(products);

  return NextResponse.json({ ok: true, product: products[idx] });
}