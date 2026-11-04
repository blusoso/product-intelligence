import { NextRequest, NextResponse } from 'next/server';
import { readSnapshot } from '@/lib/network/store';
import { readAutoRun } from '@/lib/network/auto';
import { flattenAttributes } from '@/lib/network/attributes';
import { currentRecords } from '@/lib/network/current-records';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Part = 'nodes' | 'edges' | 'records' | 'report' | 'graph' | 'attributes' | 'opportunities';

function csvCell(v: any): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function toCsv(rows: Record<string, any>[], columns: string[]): string {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\r\n');
  return `\uFEFF${head}\r\n${body}`;
}

const RECORD_COLUMNS = [
  'node_key', 'ext', 'product_id', 'shop_id', 'shop_name', 'name', 'category',
  'product_type', 'brand', 'province', 'region', 'size_label', 'width_cm', 'depth_cm',
  'height_cm', 'currency', 'price', 'price_before_discount',
  'discount_pct', 'monthly_sold', 'historical_sold', 'rating', 'review_count',
  'trust_score', 'datasource_tier', 'listing_age_days', 'quality_score', 'quality_flags',
  'gate_status', 'gate_reasons', 'risk_level', 'risk_flags', 'damage_mentions',
  'strict_return_policy', 'claim_support',
  'opportunity_class', 'internal_tier', 'opportunity_score',
  // หลักฐาน (rule) — คนละคอลัมน์กับ AI
  'use_cases', 'functions', 'contexts', 'styles', 'spaces', 'audiences', 'target_contexts',
  'price_segment', 'price_segment_basis', 'price_segment_percentile', 'price_segment_sample',
  'materials', 'colors',
  // AI อนุมาน (แยกชัดเจน)
  'ai_use_case', 'ai_function', 'ai_context', 'ai_style', 'ai_space',
  'ai_audience', 'ai_occasion', 'ai_adjustability', 'ai_power_source', 'ai_assembly', 'ai_finish',
  'ai_confidence', 'ai_grounded', 'ai_status',
];

function recordRow(r: any): Record<string, any> {
  const e = r.enrichment ?? {};
  const ai = r.ai ?? null;
  const join = (tags?: Array<{ value: string }>) => (tags ?? []).map((t) => t.value).join('; ');
  const aiBy = (attr: string) =>
    (ai?.tags ?? [])
      .filter((t: any) => t.attribute === attr)
      .map((t: any) => t.value)
      .join('; ');
  return {
    ...r,
    gate_status: r.gate?.status ?? '',
    gate_reasons: (r.gate?.reasons ?? []).join('; '),
    datasource_tier: r.datasource_tier ?? '',
    risk_level: r.trust_risk?.level ?? '',
    risk_flags: (r.trust_risk?.flags ?? []).join('; '),
    damage_mentions: r.trust_risk?.review.damage_mentions ?? 0,
    strict_return_policy: r.trust_risk?.policy.strict_return ?? false,
    claim_support: r.trust_risk?.policy.claim_support ?? false,
    opportunity_class: r.opportunity?.class ?? '',
    internal_tier: r.internal_tier ?? r.opportunity?.class ?? '',
    opportunity_score: r.opportunity?.score ?? '',
    price_segment: e.price_segment?.label ?? '',
    price_segment_basis: e.price_segment?.basis ?? '',
    price_segment_percentile: e.price_segment?.percentile ?? '',
    price_segment_sample: e.price_segment?.sample ?? '',
    use_cases: join(e.use_cases),
    functions: join(e.functions),
    contexts: join(e.contexts),
    styles: join(e.styles),
    spaces: join(e.spaces),
    audiences: join(e.audiences),
    target_contexts: join(e.target_contexts),
    materials: (r.materials ?? []).join('; '),
    colors: (r.colors ?? []).join('; '),
    ai_use_case: aiBy('use_case'),
    ai_function: aiBy('function'),
    ai_context: aiBy('context'),
    ai_style: aiBy('style'),
    ai_space: aiBy('space'),
    ai_audience: aiBy('audience'),
    ai_occasion: aiBy('occasion'),
    ai_adjustability: aiBy('adjustability'),
    ai_power_source: aiBy('power_source'),
    ai_assembly: aiBy('assembly'),
    ai_finish: aiBy('finish'),
    ai_confidence: (ai?.tags ?? []).map((t: any) => `${t.attribute}:${t.confidence}`).join('; '),
    ai_grounded: (ai?.tags ?? []).map((t: any) => `${t.attribute}:${t.grounded ? 'quote' : 'inferred'}`).join('; '),
    ai_status: ai?.meta?.status ?? '',
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const part = (url.searchParams.get('part') ?? 'graph') as Part;
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';

    const snapshot = await readSnapshot();
    const auto = snapshot ? null : (await readAutoRun()).last;
    const needsGraph = part === 'nodes' || part === 'edges' || part === 'graph' || part === 'opportunities';

    if (!snapshot && needsGraph) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ต้องสร้างกราฟก่อน (ขั้น 4) — ส่วน records/report ดาวน์โหลดได้จากการประมวลผลอัตโนมัติ',
        },
        { status: 409 },
      );
    }
    if (!snapshot && !auto) {
      return NextResponse.json(
        { ok: false, error: 'ยังไม่มีข้อมูล — รอ ingestion หรือกด "ประมวลผลใหม่"' },
        { status: 404 },
      );
    }

    const records: any[] = snapshot ? (snapshot.records as any[]) : (auto?.records as any[]) ?? [];
    const report: any = snapshot ? snapshot.report : auto?.report_after ?? null;

    const stamp = new Date().toISOString().slice(0, 10);
    let body: any = '';
    let filename = `pi-network-${part}-${stamp}.${format}`;
    let contentType = 'application/json; charset=utf-8';

    if (part === 'nodes') {
      body = format === 'csv'
        ? toCsv(
            snapshot!.graph.nodes.map((n) => ({ ...n, attributes: JSON.stringify(n.attributes) })),
            ['id', 'type', 'label', 'weight', 'attributes'],
          )
        : JSON.stringify(snapshot!.graph.nodes, null, 2);
    } else if (part === 'edges') {
      body = format === 'csv'
        ? toCsv(
            snapshot!.graph.edges.map((e) => ({ ...e, evidence: JSON.stringify(e.evidence) })),
            ['id', 'type', 'source', 'target', 'directed', 'weight', 'evidence'],
          )
        : JSON.stringify(snapshot!.graph.edges, null, 2);
    } else if (part === 'records') {
      body = format === 'csv'
        ? toCsv(records.map(recordRow), RECORD_COLUMNS)
        : JSON.stringify(records, null, 2);
    } else if (part === 'report') {
      body = JSON.stringify(report, null, 2);
    } else if (part === 'attributes') {
      // ค่าเริ่มต้นใส่แถวว่างให้ครบ 18 attribute ต่อสินค้า (พิสูจน์ว่ามาตรฐานเดียวกัน)
      // ใช้ include_empty=0 เพื่อเอาเฉพาะค่าที่มีจริง
      const includeEmpty = url.searchParams.get('include_empty') !== '0';
      const fresh = await currentRecords();
      const longRows = fresh.records.flatMap((r) =>
        flattenAttributes(r, { includeEmpty }).map((row) => ({
          ext: r.ext ?? '',
          product_id: r.product_id ?? '',
          name: r.name ?? '',
          ...row,
        })),
      );
      body =
        format === 'csv'
          ? toCsv(longRows, [
              'ext', 'product_id', 'name',
              'attribute', 'attribute_label', 'value_id', 'value_label',
              'source', 'confidence', 'evidence', 'grounded', 'conflict', 'ai_model',
              'evidence_type', 'visual', 'overridden',
            ])
          : JSON.stringify(longRows, null, 2);
    } else if (part === 'opportunities') {
      if (!snapshot || !Array.isArray(snapshot.opportunities)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'snapshot นี้ยังไม่มีผลจัดประเภทโอกาส — กดสร้างกราฟใหม่ (ขั้น 4) ก่อน',
          },
          { status: 409 },
        );
      }
      const rows = snapshot.opportunities.map((o) => ({
        ...o,
        gate_status: o.gate.status,
        gate_reasons: o.gate.reasons.join('; '),
        risk_level: o.trust_risk?.level ?? '',
        risk_flags: (o.trust_risk?.flags ?? []).join('; '),
        metrics: JSON.stringify(o.metrics),
        evidence: JSON.stringify(o.evidence),
        risk: JSON.stringify(o.trust_risk ?? null),
      }));
      body =
        format === 'csv'
          ? toCsv(rows, [
              'node_key', 'ext', 'name', 'class', 'internal_tier', 'datasource_tier',
              'risk_level', 'risk_flags', 'score', 'price', 'url',
              'gate_status', 'gate_reasons', 'metrics', 'evidence', 'risk', 'explain_th',
            ])
          : JSON.stringify(snapshot.opportunities, null, 2);
    } else {
      body = JSON.stringify(snapshot, null, 2);
    }

    if (format === 'csv') contentType = 'text/csv; charset=utf-8';

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    console.error('[network/export]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
