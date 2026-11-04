import { NextResponse } from 'next/server';
import { reviewOptions } from '@/lib/network/review';

export const dynamic = 'force-dynamic';

/** GET /api/products/options — รายการตัวเลือกของฟอร์มแก้ไข (ประเภทสินค้า/แบรนด์/จังหวัด/attribute) */
export async function GET() {
  return NextResponse.json({ ok: true, ...reviewOptions() });
}
