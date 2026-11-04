import { NextRequest, NextResponse } from 'next/server';
import { loadProducts } from '@/lib/network/source';
import { DEFAULT_CONFIG, runPipeline } from '@/lib/network/pipeline';
import { mergeConfig } from '@/lib/network/config';
import { readStoredConfig } from '@/lib/network/persist';
import { conflictCounts, enqueueConflicts } from '@/lib/network/conflicts';
import { reconcileWithRules } from '@/lib/network/ai';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/network/conflicts/scan
 * ------------------------------------------------------------------
 * สแกนคิว "ขัดแย้งรอตรวจ" ใหม่จากข้อมูลที่เก็บไว้แล้ว
 *  - รันกฎ/หลักฐานใหม่ + นำแท็ก AI ที่บันทึกไว้มาเทียบกับหลักฐาน (reconcile)
 *  - ไม่เรียก AI และไม่แตะค่าที่คนตัดสินแล้ว (idempotent ผ่าน UNIQUE)
 * ใช้เมื่อ: แก้กฎ/พจนานุกรมวลี แล้วอยากเห็นผลทันทีโดยไม่ต้องรัน pipeline เต็มรอบ
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const stored = await readStoredConfig();
    const { updated_at: _ignored, ...storedConfig } = stored ?? {};
    const config = mergeConfig(mergeConfig(DEFAULT_CONFIG, storedConfig), body);

    const loaded = await loadProducts('db');
    const result = runPipeline(loaded.products, {
      ...config,
      source: loaded.source,
      build_graph: false,
      ai_enrich: false,
      vision_enrich: false,
    });

    // แท็กที่เก็บไว้ยังไม่ผ่าน reconcile ของหลักฐานชุดล่าสุด — ทำใหม่แบบไม่เรียก AI
    let withAi = 0;
    for (const p of result.products) {
      const tags = p.ai?.tags ?? [];
      if (!tags.length) continue;
      p.ai = { ...p.ai!, tags: reconcileWithRules(tags, p) };
      withAi += 1;
    }

    const queue = await enqueueConflicts(result.products);
    const counts = await conflictCounts();

    return NextResponse.json({
      ok: queue.persisted !== 'none',
      scanned: result.products.length,
      with_ai: withAi,
      ...queue,
      counts,
      error: queue.error ?? (queue.persisted === 'none' ? 'บันทึกคิวไม่สำเร็จ' : undefined),
    });
  } catch (e: any) {
    console.error('[network/conflicts/scan]', e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
