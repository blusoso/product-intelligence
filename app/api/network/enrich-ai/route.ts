import { NextRequest, NextResponse } from 'next/server';
import { runAiBackfill, type AiBackfillEvent, type BackfillPhase } from '@/lib/network/auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** backfill อาจใช้เวลานาน (เรียก AI ทีละ batch) */
export const maxDuration = 300;

/**
 * POST — เติม ai_enrichment ให้สินค้าที่มีอยู่แล้ว (ทำทีละชุดตาม ai_max_records_per_run)
 * body: { limit?: number, budget_ms?: number, phase?: 'text'|'vision'|'all' }
 * query: ?phase=vision
 *
 * `?stream=1` → ตอบเป็น NDJSON ทีละอีเวนต์ (stage / progress / vision_progress / done / error)
 * ให้ UI วาด progress bar ได้ระหว่างทำงาน — ถ้าไม่ส่ง จะตอบ JSON ก้อนเดียวเหมือนเดิม
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const limit = Number(body?.limit);
  const budget = Number(body?.budget_ms);
  const force = body?.force === true;
  const rawPhase = String(req.nextUrl.searchParams.get('phase') ?? body?.phase ?? 'all');
  const phase: BackfillPhase = rawPhase === 'vision' ? 'vision' : rawPhase === 'text' ? 'text' : 'all';
  const opts = {
    ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.round(limit) } : {}),
    ...(Number.isFinite(budget) && budget > 0 ? { budgetMs: Math.round(budget) } : {}),
    ...(force ? { force: true } : {}),
    ...(phase !== 'all' ? { phase } : {}),
  };

  const wantsStream = req.nextUrl.searchParams.get('stream') === '1';
  if (!wantsStream) {
    try {
      const result = await runAiBackfill(opts);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: AiBackfillEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true; // client ตัดสายไปแล้ว
        }
      };

      try {
        const result = await runAiBackfill({
          ...opts,
          onEvent: send,
          shouldStop: () => req.signal.aborted,
        });
        send({ type: 'done', result });
      } catch (e: any) {
        send({ type: 'error', error: e?.message || String(e) });
      } finally {
        try {
          controller.close();
        } catch {
          /* ปิดไปแล้ว */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
