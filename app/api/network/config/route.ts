import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_CONFIG } from '@/lib/network/pipeline';
import { mergeConfig, presetsFrom } from '@/lib/network/config';
import { readStoredConfig, writeStoredConfig } from '@/lib/network/persist';
import type { PipelineConfig } from '@/lib/network/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// GET: อ่านค่าที่บันทึกไว้ (merge กับ default) / PUT: บันทึกค่าที่ clamp แล้ว

async function currentConfig(): Promise<{ config: PipelineConfig; updated_at: string | null }> {
  const stored = await readStoredConfig();
  const { updated_at, ...rest } = stored ?? {};
  return {
    config: mergeConfig(DEFAULT_CONFIG, rest),
    updated_at: updated_at ?? null,
  };
}

export async function GET() {
  try {
    const { config, updated_at } = await currentConfig();
    return NextResponse.json({
      ok: true,
      config,
      defaults: DEFAULT_CONFIG,
      presets: presetsFrom(DEFAULT_CONFIG),
      updated_at,
    });
  } catch (e: any) {
    console.error('[network/config]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { config } = await currentConfig();
    const next = mergeConfig(config, body);
    const saved = await writeStoredConfig(next);
    return NextResponse.json({
      ok: true,
      config: next,
      defaults: DEFAULT_CONFIG,
      presets: presetsFrom(DEFAULT_CONFIG),
      updated_at: saved.updated_at ?? null,
    });
  } catch (e: any) {
    console.error('[network/config]', e);
    return NextResponse.json({ ok: false, error: e.message || String(e) }, { status: 500 });
  }
}
