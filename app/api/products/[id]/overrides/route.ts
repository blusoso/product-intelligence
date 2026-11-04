import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildReviewDetail } from '@/lib/network/review';
import { ATTRIBUTE_MAP, isAttrId, valueLabel, valuesOf } from '@/lib/network/vocab';
import type { AttributeOverrideMap } from '@/lib/network/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/products/:id/overrides — admin แก้ค่าของ attribute เอง
 * body: { attribute: 'context', values: [{ value_id: 'kitchen' }] }
 *       { attribute: 'context', clear: true }
 *
 * ข้อจำกัด: แก้ได้เฉพาะ 11 attribute ที่มาจากการตีความ (vocab)
 * ค่าต้องเป็น id ที่มีจริงในคลังคำ — กันการพิมพ์ค่าเดาที่ทำให้ข้อมูลเพี้ยน
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const attribute = String(body?.attribute ?? '');

    if (!isAttrId(attribute)) {
      return NextResponse.json(
        { ok: false, error: `attribute "${attribute}" แก้ไม่ได้ (แก้ได้เฉพาะค่าที่ตีความจากข้อความ)` },
        { status: 400 },
      );
    }
    const def = ATTRIBUTE_MAP[attribute];

    const { data: current, error: readError } = await supabase
      .from('products')
      .select('id,attribute_overrides')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

    const overrides: AttributeOverrideMap = { ...((current as any).attribute_overrides ?? {}) };

    if (body?.clear === true) {
      delete overrides[attribute];
    } else {
      const raw: any[] = Array.isArray(body?.values) ? body.values : [];
      const ids = [...new Set<string>(raw.map((v: any) => String(v?.value_id ?? v ?? '').trim()).filter(Boolean))];
      if (!ids.length) {
        return NextResponse.json({ ok: false, error: 'ต้องเลือกอย่างน้อย 1 ค่า (หรือส่ง clear:true เพื่อล้าง)' }, { status: 400 });
      }
      if (ids.length > def.max_per_record) {
        return NextResponse.json(
          { ok: false, error: `attribute นี้ใส่ได้ไม่เกิน ${def.max_per_record} ค่า` },
          { status: 400 },
        );
      }
      const allowed = new Set(valuesOf(attribute).map((v) => v.id));
      const bad = ids.filter((v: string) => !allowed.has(v));
      if (bad.length) {
        return NextResponse.json({ ok: false, error: `ไม่รู้จักค่า: ${bad.join(', ')}` }, { status: 400 });
      }
      overrides[attribute] = {
        values: ids.map((value_id: string) => ({ value_id, label: valueLabel(attribute, value_id) })),
        at: new Date().toISOString(),
        by: 'admin',
        ...(body?.note ? { note: String(body.note).slice(0, 300) } : {}),
      };
    }

    const nextValue = Object.keys(overrides).length ? overrides : null;
    const { data, error: writeError } = await supabase
      .from('products')
      .update({ attribute_overrides: nextValue })
      .eq('id', id)
      .select('*')
      .single();
    if (writeError) throw writeError;

    return NextResponse.json({
      ok: true,
      attribute,
      cleared: body?.clear === true,
      ...buildReviewDetail(data as Record<string, any>),
    });
  } catch (e: any) {
    console.error('[PUT /api/products/:id/overrides]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
