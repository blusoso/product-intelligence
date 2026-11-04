import { NextRequest, NextResponse } from 'next/server';
import { resolveConflict, type ResolveAction } from '@/lib/network/conflicts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTIONS: ResolveAction[] = ['accept_rule', 'accept_ai', 'dismiss'];

/**
 * POST /api/network/conflicts/resolve
 * body: { ext, attribute, value_id, action: 'accept_rule'|'accept_ai'|'dismiss', note? }
 *
 * - accept_ai  → เขียน attribute_overrides (manual ชนะทุกชั้น; pipeline ไม่เขียนทับ)
 * - accept_rule→ ยึดหลักฐานเป็นตัวจริง (ไม่เขียน override)
 * - dismiss    → ไม่ใช่ปัญหา (ปิดคิว)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ext = String(body?.ext ?? '').trim();
    const attribute = String(body?.attribute ?? '').trim();
    const value_id = String(body?.value_id ?? '').trim();
    const action = String(body?.action ?? '') as ResolveAction;

    if (!ext || !attribute || !value_id) {
      return NextResponse.json({ ok: false, error: 'ต้องส่ง ext, attribute, value_id' }, { status: 400 });
    }
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: `action ต้องเป็น ${ACTIONS.join(' | ')}` }, { status: 400 });
    }

    const result = await resolveConflict({
      ext,
      attribute,
      value_id,
      action,
      ...(body?.note ? { note: String(body.note) } : {}),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
