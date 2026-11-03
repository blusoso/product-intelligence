import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'products.json');

// ฟังก์ชันตรวจสอบข้อมูลเก่า (ที่ไม่มี Rating หรือ Sold ส่งมา)
function isLegacy(p: any) {
  return p.monthly_sold === undefined && p.rating === undefined && p.historical_sold === undefined;
}

// GET: ดูจำนวนข้อมูลเก่า
export async function GET() {
  try {
    const raw = await fs.readFile(FILE, 'utf8').catch(() => '[]');
    const products = JSON.parse(raw);
    const legacy = products.filter(isLegacy);
    
    return NextResponse.json({
      ok: true,
      count: legacy.length,
      total: products.length,
      samples: legacy.slice(0, 5).map((p: any) => ({ id: p.id, name: p.name, ext: p.ext }))
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// POST: จัดการข้อมูลเก่า (ลบ หรือ ส่งออก ID)
export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();
    const raw = await fs.readFile(FILE, 'utf8').catch(() => '[]');
    const products = JSON.parse(raw);
    const legacy = products.filter(isLegacy);

    if (action === 'purge') {
      // กรองเอาเฉพาะข้อมูลใหม่ที่สมบูรณ์
      const cleaned = products.filter((p: any) => !isLegacy(p));
      
      // Backup ข้อมูลเดิมไว้ก่อนลบ
      const bak = `${FILE}.bak_legacy_${Date.now()}`;
      await fs.writeFile(bak, raw, 'utf8');
      
      // เขียนทับ
      await fs.writeFile(FILE, JSON.stringify(cleaned, null, 2), 'utf8');
      return NextResponse.json({ ok: true, removed: legacy.length, remaining: cleaned.length });
    }
    
    if (action === 'export') {
      // ดึง ID ออกมาเพื่อเอาไป Scrape ใหม่
      const ids = legacy.map((p: any) => {
        if (p.product_id && p.shop_id) return { shop_id: p.shop_id, product_id: p.product_id };
        if (p.ext && p.ext.startsWith('shopee:')) {
          const parts = p.ext.split(':');
          return { shop_id: parts[1], product_id: parts[2] };
        }
        return null;
      }).filter(Boolean);
      
      return NextResponse.json({ ok: true, ids });
    }

    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}