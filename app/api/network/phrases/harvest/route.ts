import { NextRequest, NextResponse } from 'next/server';
import { harvestPhrases, loadPhrases } from '@/lib/network/phrase-memory';
import { loadProducts } from '@/lib/network/source';
import { runPipeline } from '@/lib/network/pipeline';
import { baseConfig } from '@/lib/network/auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * GET  /api/network/phrases/harvest → ดูสถานะพจนานุกรมวลี
 * POST /api/network/phrases/harvest → เรียนรู้วลีจาก ai_enrichment ที่มีอยู่ (one-time seed)
 *
 * ใช้ตอนย้าย prompt version: เก็บความรู้จากผลรอบก่อนไว้ก่อน แล้วค่อยล้าง cache
 * ไม่เรียก AI และไม่เขียนทับ ai_enrichment (อ่านอย่างเดียว + เขียนตารางวลี)
 */
export async function GET() {
  const { stats } = await loadPhrases();
  return NextResponse.json({ ok: true, ...stats });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dry = body?.dry === true;

    const config = await baseConfig();
    const loaded = await loadProducts('db');
    if (loaded.source !== 'db' || !loaded.products.length) {
      return NextResponse.json(
        { ok: false, error: 'ตาราง products ว่างหรือเชื่อมต่อไม่ได้' },
        { status: 400 },
      );
    }

    // normalize + rule enrichment (ไม่เรียก AI) เพื่อให้มี ai_enrichment ที่บันทึกไว้ติดมาด้วย
    const result = runPipeline(loaded.products, { ...config, source: 'db', build_graph: false });
    const withAi = result.products.filter((p) => p.ai?.tags?.length);

    if (dry) {
      const quotes = withAi.flatMap((p) =>
        (p.ai?.tags ?? []).filter((t) => t.grounded && t.quote && t.origin !== 'phrase'),
      );
      return NextResponse.json({
        ok: true,
        dry: true,
        products: result.products.length,
        products_with_ai: withAi.length,
        grounded_quotes: quotes.length,
        distinct: new Set(quotes.map((t) => `${t.attribute}|${t.value_id}|${t.quote}`)).size,
      });
    }

    const harvested = await harvestPhrases(result.products);
    const { stats } = await loadPhrases();
    return NextResponse.json({ ok: true, ...harvested, phrases: stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
