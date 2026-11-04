import { NextRequest, NextResponse } from 'next/server';
import { visionStatus, visionAvailable, resolveVisionConfig, VISION_PROMPT_PREVIEW } from '@/lib/network/vision';
import { readAutoRun } from '@/lib/network/auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * GET /api/network/vision/health
 * - ตรวจว่าตั้งค่า VISION_* ครบหรือยัง (ไม่เรียกผู้ให้บริการ)
 * - `?dry=1` คืน request body ตัวอย่าง (key ถูกปิด) เพื่อ debug
 * - จำนวนที่ยังขาดมาจาก auto-run ล่าสุด (ไม่สแกน DB ทั้งตาราง)
 */
export async function GET(req: NextRequest) {
  const cfg = resolveVisionConfig();
  const status = visionStatus();
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const view = await readAutoRun().catch(() => null);
  const missing = view?.last?.summary?.vision_missing ?? null;

  const base = {
    ok: visionAvailable(),
    ...status,
    key: maskKey(process.env.VISION_API_KEY || process.env.AI_API_KEY),
    /** จำนวนแถวที่ยังไม่มีค่าจากภาพ (จาก auto-run ล่าสุด — null = ยังไม่เคยรัน) */
    missing,
    // สาเหตุที่ใช้ไม่ได้ ต้องมากับทุก response (ไม่ใช่แค่ตอน ?dry=1) ให้ UI อธิบายได้
    ...(visionAvailable()
      ? {}
      : {
          reason: 'no_api_key',
          hint: 'ใส่ AI_API_KEY (DeepSeek อ่านภาพได้) หรือ VISION_API_KEY ใน .env แล้ว restart dev server',
        }),
  };

  if (dry) {
    return NextResponse.json({
      ...base,
      dry: true,
      request_preview: {
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { Authorization: 'Bearer ***', 'Content-Type': 'application/json' },
        body: {
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          stream: false,
          temperature: 0,
          response_format: cfg.jsonMode ? { type: 'json_object' } : undefined,
          thinking: cfg.provider === 'deepseek' ? { type: cfg.thinking ? 'enabled' : 'disabled' } : undefined,
          messages: [
            { role: 'system', content: VISION_PROMPT_PREVIEW },
            {
              role: 'user',
              content: [
                { type: 'text', text: '<product summary + visual vocabulary>' },
                { type: 'image_url', image_url: { url: '<image url | data:image/...>', detail: cfg.detail } },
              ],
            },
          ],
        },
      },
    });
  }

  return NextResponse.json(base);
}
