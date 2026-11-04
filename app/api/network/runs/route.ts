import { NextRequest, NextResponse } from 'next/server';
import { readRuns } from '@/lib/network/persist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 50);
    const runs = await readRuns(limit);

    // runs มาแบบใหม่→เก่า; delta เทียบกับรายการก่อนหน้า (index + 1)
    const withDelta = runs.map((run, i) => {
      const prev = runs[i + 1];
      return {
        ...run,
        delta: prev
          ? {
              readiness: run.readiness - prev.readiness,
              edges: run.edges - prev.edges,
              nodes: run.nodes - prev.nodes,
              score_after: run.score_after - prev.score_after,
              products: run.kept - prev.kept,
            }
          : null,
      };
    });

    return NextResponse.json({ ok: true, count: withDelta.length, runs: withDelta });
  } catch (e: any) {
    console.error('[network/runs]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
