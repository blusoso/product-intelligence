import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot } from '@/lib/network/store';
import type { OpportunityClass } from '@/lib/network/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CLASSES = new Set<OpportunityClass>(['proven', 'hidden', 'emerging']);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ยังไม่มี graph snapshot — กด "สร้างกราฟและบันทึก" ในหน้า Network ก่อน',
        },
        { status: 404 },
      );
    }
    if (!Array.isArray(snapshot.opportunities)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'snapshot นี้ยังไม่มีผลจัดประเภทโอกาส',
          hint: 'กดสร้างกราฟใหม่ (ขั้น 4) เพื่อคำนวณ Proven / Hidden / Emerging',
        },
        { status: 409 },
      );
    }

    const clsParam = (url.searchParams.get('class') ?? '').trim() as OpportunityClass;
    const classFilter = CLASSES.has(clsParam) ? clsParam : null;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500);

    const all = snapshot.opportunities;
    const items = (classFilter ? all.filter((o) => o.class === classFilter) : all).slice(0, limit);

    const classCounts: Record<OpportunityClass, number> = { proven: 0, hidden: 0, emerging: 0 };
    const riskCounts = { low: 0, medium: 0, high: 0 };
    const datasourceTierCounts: Record<string, number> = {};
    for (const o of all) {
      classCounts[o.class] += 1;
      if (o.trust_risk?.level) riskCounts[o.trust_risk.level] += 1;
      if (o.datasource_tier) {
        datasourceTierCounts[o.datasource_tier] = (datasourceTierCounts[o.datasource_tier] ?? 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      generated_at: snapshot.meta.generated_at,
      meta: snapshot.meta,
      gate_counts: snapshot.graph.stats.by_gate_status ?? { pass: 0, review: 0, blocked: 0 },
      class_counts: classCounts,
      risk_counts: riskCounts,
      datasource_tier_counts: datasourceTierCounts,
      diagnostics: snapshot.diagnostics ?? null,
      total: all.length,
      shown: items.length,
      items,
    });
  } catch (e: any) {
    console.error('[network/opportunities]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
