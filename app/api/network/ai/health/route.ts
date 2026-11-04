import { NextRequest, NextResponse } from 'next/server';
import { aiAvailable, resolveAiConfig, SYSTEM_PROMPT_PREVIEW } from '@/lib/network/ai';
import { countMissingAi } from '@/lib/network/auto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

interface ProviderCheck {
  ok: boolean;
  status?: number;
  latency_ms?: number;
  models?: string[];
  balance?: unknown;
  error?: string;
}

async function getJson(url: string, timeoutMs: number): Promise<{ status: number; body: any } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'timeout' : e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/network/ai/health
 * - ตรวจ key/provider/model ด้วย GET /models (+ /user/balance ถ้ามี)
 * - ?dry=1 คืน request body ตัวอย่าง (key ถูกปิด) โดยไม่เรียกผู้ให้บริการ
 */
export async function GET(req: NextRequest) {
  const cfg = resolveAiConfig();
  const available = aiAvailable();
  const missing = await countMissingAi();
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const base = {
    ok: available,
    available,
    provider: cfg.provider,
    model: cfg.model,
    base_url: cfg.baseUrl,
    thinking: cfg.thinking,
    json_mode: cfg.jsonMode,
    max_tokens: cfg.maxTokens,
    batch_size: cfg.batchSize,
    concurrency: cfg.concurrency,
    temperature: cfg.thinking ? null : cfg.temperature,
    key: maskKey(process.env.AI_API_KEY),
    missing,
  };

  if (dry) {
    return NextResponse.json({
      ...base,
      dry: true,
      ...(available ? {} : { reason: 'no_api_key', hint: 'ใส่ AI_API_KEY ใน .env แล้ว restart dev server' }),
      request_preview: {
        url: `${cfg.baseUrl}/chat/completions`,
        headers: { Authorization: 'Bearer ***', 'Content-Type': 'application/json' },
        body: {
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          stream: false,
          response_format: cfg.jsonMode ? { type: 'json_object' } : undefined,
          thinking: cfg.provider === 'deepseek' ? { type: cfg.thinking ? 'enabled' : 'disabled' } : undefined,
          temperature: cfg.thinking ? undefined : cfg.temperature,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT_PREVIEW },
            { role: 'user', content: '<vocabulary + items json>' },
          ],
        },
      },
    });
  }

  if (!available) {
    return NextResponse.json({
      ...base,
      reason: 'no_api_key',
      hint: 'ใส่ AI_API_KEY ใน .env แล้ว restart dev server',
    });
  }

  const started = Date.now();
  const models = await getJson(`${cfg.baseUrl}/models`, cfg.timeoutMs);
  const latency = Date.now() - started;
  const check: ProviderCheck = { ok: false };
  if ('error' in models) {
    check.error = models.error;
  } else {
    const list = Array.isArray(models.body?.data)
      ? models.body.data.map((m: any) => String(m?.id ?? '')).filter(Boolean)
      : [];
    check.status = models.status;
    check.latency_ms = latency;
    check.models = list;
    check.ok = models.status === 200;
    if (!check.ok) check.error = `HTTP ${models.status}`;
    if (check.ok && !list.includes(cfg.model)) {
      check.error = `โมเดล "${cfg.model}" ไม่อยู่ในรายการ — ตรวจ AI_MODEL`;
      check.ok = false;
    }
  }

  let balance: unknown = null;
  if (check.ok) {
    const bal = await getJson(`${cfg.baseUrl}/user/balance`, cfg.timeoutMs);
    if (!('error' in bal) && bal.status === 200) balance = bal.body;
  }

  return NextResponse.json({
    ...base,
    ok: check.ok,
    check,
    balance,
  });
}
