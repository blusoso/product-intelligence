import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { baseConfig } from '@/lib/network/auto';
import { applyCoreFields } from '@/lib/network/apply';
import { aiAvailable, enrichWithAi, resolveAiConfig } from '@/lib/network/ai';
import { runPipeline } from '@/lib/network/pipeline';
import { flattenRow } from '@/lib/network/source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/products/:id/enrich-ai — เรียก AI ใหม่เฉพาะสินค้า 1 ชิ้น
 * ใช้เมื่อคนตรวจเห็นว่า AI ยังไม่ดีในแถวนั้น (ไม่ต้องรันทั้งชุด)
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    if (!aiAvailable()) {
      return NextResponse.json(
        { ok: false, error: 'AI ปิดอยู่ — ตั้ง AI_API_KEY ใน .env แล้ว restart dev server' },
        { status: 400 },
      );
    }

    const { id } = await ctx.params;
    const { data: row, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

    let payload: unknown = null;
    if (row.ext) {
      const { data: rawRow } = await supabase
        .from('raw_products')
        .select('payload')
        .eq('ext', row.ext)
        .maybeSingle();
      payload = rawRow?.payload ?? null;
    }

    const merged = flattenRow(row, payload ?? undefined);
    const cfg = await baseConfig();
    const result = runPipeline([merged], { ...cfg, source: 'db', build_graph: false });
    const product = result.products[0];
    if (!product) {
      return NextResponse.json({ ok: false, error: 'แถวนี้ไม่มีข้อมูลพอจะ normalize (ชื่อ/รหัสสินค้า)' }, { status: 400 });
    }

    // บังคับเรียกใหม่ ไม่ใช้ผลเดิม
    (product as any).ai = null;
    const ai = await enrichWithAi([product], {
      config: { ...cfg, ai_max_records_per_run: 1 },
      secondPass: true,
    });
    const sync = await applyCoreFields([product], 'db', 'normalized');
    const cfgAi = resolveAiConfig();
    const finalAi = (product as any).ai as { tags?: unknown[]; meta?: Record<string, any> } | null;

    return NextResponse.json({
      ok: true,
      provider: cfgAi.provider,
      model: cfgAi.model,
      tags: finalAi?.tags ?? [],
      meta: finalAi?.meta ?? null,
      stats: ai.stats,
      sync,
    });
  } catch (e: any) {
    console.error('[POST /api/products/:id/enrich-ai]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
