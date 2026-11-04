import { NextRequest, NextResponse } from 'next/server';
import { readLatestMeta, readSnapshot } from '@/lib/network/store';
import { filterGraph } from '@/lib/network/graph';
import type { EdgeType, NodeType } from '@/lib/network/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NODE_TYPES = new Set([
  'product', 'shop', 'brand', 'category', 'product_type', 'province', 'region',
  // enrichment (หลักฐาน) + AI (อนุมาน) — แยกชนิดกันชัดเจน
  'use_case', 'function', 'context', 'style', 'space', 'audience', 'price_segment', 'variant',
  'ai_attribute',
]);
const EDGE_TYPES = new Set([
  'sold_by', 'brand_of', 'in_category', 'has_type', 'located_in',
  'shop_located_in', 'part_of_region', 'subtype_of', 'similar_to', 'substitute', 'complements',
  'same_context', 'used_with',
  'used_for', 'has_function', 'fits_context', 'has_style', 'fits_space', 'targets_audience',
  'in_price_segment', 'variant_of', 'same_product_as', 'ai_about',
]);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          error: 'ยังไม่มี graph snapshot — กด "Prepare & Save" ในหน้า Network ก่อน',
          meta: await readLatestMeta(),
        },
        { status: 404 },
      );
    }

    const nodeTypes = (url.searchParams.get('node_type') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => NODE_TYPES.has(s)) as NodeType[];
    const edgeTypes = (url.searchParams.get('edge_type') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => EDGE_TYPES.has(s)) as EdgeType[];
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 400), 10), 5000);

    const { nodes, edges } = filterGraph(snapshot.graph, {
      nodeTypes,
      edgeTypes,
      limit,
    });

    return NextResponse.json({
      ok: true,
      meta: snapshot.meta,
      stats: snapshot.graph.stats,
      report: snapshot.report,
      nodes,
      edges,
      truncated: edges.length >= limit,
    });
  } catch (e: any) {
    console.error('[network/graph]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
