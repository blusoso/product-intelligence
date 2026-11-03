import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { initialProducts } from '@/lib/data';

const FILE = path.join(process.cwd(), 'data', 'products.json');

async function readProducts(): Promise<any[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return [...initialProducts];
  }
}

async function writeProducts(products: any[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(products, null, 2), 'utf8');
}

export async function GET() {
  const products = await readProducts();
  return NextResponse.json({ count: products.length, products });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const products = Array.isArray(body) ? body : body.products;
    if (!Array.isArray(products)) {
      return NextResponse.json({ ok: false, error: 'expected products[]' }, { status: 400 });
    }
    await writeProducts(products);
    return NextResponse.json({ ok: true, count: products.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
