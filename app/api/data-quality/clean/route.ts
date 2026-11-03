import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { runPipeline } from '@/lib/data-quality/pipeline';

const FILE = path.join(process.cwd(), 'data', 'products.json');

export async function POST(req: NextRequest) {
  try {
    const { apply } = await req.json().catch(() => ({ apply: false }));
    const raw = await fs.readFile(FILE, 'utf8');
    const products = JSON.parse(raw);

    const result = runPipeline(products);

    if (apply) {
      const bak = `${FILE}.bak_${Date.now()}`;
      await fs.writeFile(bak, raw, 'utf8');
      await fs.writeFile(FILE, JSON.stringify(result.products, null, 2), 'utf8');
    }

    return NextResponse.json({
      ok: true,
      applied: !!apply,
      summary: {
        input: result.input_count,
        output: result.output_count,
        dropped: result.dropped.length,
        changes: result.changes.length,
        elapsed_ms: result.elapsed_ms,
      },
      report_before: result.report_before,
      report_after: result.report_after,
      dropped: result.dropped.slice(0, 20),
      changes: result.changes.slice(0, 50),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}