import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { auditProducts } from '@/lib/data-quality/audit';

const FILE = path.join(process.cwd(), 'data', 'products.json');

export async function GET() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const products = JSON.parse(raw);
    const report = auditProducts(products);
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}