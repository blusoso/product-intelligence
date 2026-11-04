import { after, NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { mapToDatabase } from '@/lib/ingest-mapper';
import { cleanProduct } from '@/lib/data-quality/clean';
import { normalizeProduct } from '@/lib/data-quality/normalize';
import { appendRawHistory } from '@/lib/network/history';
import { autoEnabled, scheduleAutoRun } from '@/lib/network/auto';

const CHUNK_SIZE = 50;

type MappedProduct = ReturnType<typeof mapToDatabase> & { sku: string; status: string };

// ═══════════════════════════════════════════════════════════════
// POST — Bulk Ingest (upsert ทั้งชุดในไม่กี่ query)
// ═══════════════════════════════════════════════════════════════
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const rawItems = Array.isArray(body) ? body : (body.items || []);

    if (!rawItems.length) {
      return NextResponse.json({ ok: false, error: 'no items' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ─── STEP 1: บันทึก log "ก่อน" ทุกอย่าง (กันหายถ้า timeout) ───
    const { data: logData } = await supabase
      .from('ingest_logs')
      .insert({
        source: body.source || 'extension',
        keyword: body.keyword || null,
        added: 0,
        updated: 0,
        received: rawItems.length,
      })
      .select()
      .single();

    // ─── STEP 2: Bulk upsert raw_products ───
    // เก็บประวัติ payload ที่เปลี่ยน (upsert ทับของเดิม จึงต้องมี log แยก)
    const rawHistory = await appendRawHistory(rawItems, now);

    const rawRecords = rawItems.map((r: any) => ({
      ext: `shopee:${r.shop_id}:${r.product_id}`,
      payload: r,
      status: 'pending',
      last_seen_at: now,
    }));

    for (let i = 0; i < rawRecords.length; i += CHUNK_SIZE) {
      const chunk = rawRecords.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('raw_products')
        .upsert(chunk, { onConflict: 'ext' });
      if (error) console.error(`❌ raw chunk ${i}:`, error.message);
    }

    // ─── STEP 3: Clean + Normalize ทุก item (ทำใน memory ไม่แตะ DB) ───
    const productRecords: MappedProduct[] = rawItems.map((r: any, idx: number) => {
      const { cleaned } = cleanProduct(r, idx);
      const normalized = normalizeProduct(cleaned);
      const mapped = mapToDatabase(normalized);
      return {
        ...mapped,
        sku: `SKU-${Date.now()}-${idx}-${Math.floor(Math.random() * 10000)}`,
        status: 'pending',
      };
    });

    // ─── STEP 4: เช็คว่ามีอยู่ใน DB แล้วหรือยัง (query เดียว) ───
    const allExts = productRecords.map((p) => p.ext);
    const { data: existing } = await supabase
      .from('products')
      .select('ext')
      .in('ext', allExts);

    const existingSet = new Set((existing || []).map((e) => e.ext));
    const added = productRecords.filter((p) => !existingSet.has(p.ext)).length;
    const updated = productRecords.filter((p) => existingSet.has(p.ext)).length;

    // ─── STEP 5: Bulk upsert products (ทับของเก่าถ้ามี) ───
    for (let i = 0; i < productRecords.length; i += CHUNK_SIZE) {
      const chunk = productRecords.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('products')
        .upsert(chunk, { onConflict: 'ext' });
      if (error) console.error(`❌ product chunk ${i}:`, error.message);
    }

    // ─── STEP 6: อัปเดต log ด้วยจำนวนจริง ───
    if (logData) {
      await supabase
        .from('ingest_logs')
        .update({ added, updated })
        .eq('id', logData.id);
    }

    // ─── STEP 7: Mark raws เป็น processed (bulk) ───
    for (let i = 0; i < rawRecords.length; i += CHUNK_SIZE) {
      const chunk = rawRecords.slice(i, i + CHUNK_SIZE);
      await supabase
        .from('raw_products')
        .update({ status: 'processed' })
        .in('ext', chunk.map((r: { ext: string }) => r.ext));
    }

    const elapsed = Date.now() - t0;
    console.log(
      `✅ ingest: ${rawItems.length} items → ${added} added, ${updated} updated, ${elapsed}ms`,
    );

    // งานเบื้องหลัง: normalize/enrichment/AI/canonical/audit + เขียนลง products
    // (graph ไม่ได้สร้างตรงนี้ — ผู้ใช้กดสร้างกราฟเองในหน้า /network)
    const wantAuto = autoEnabled() && body.auto !== false;
    if (wantAuto) {
      after(() => {
        scheduleAutoRun({ kind: 'ingest', received: rawItems.length });
      });
    }

    return NextResponse.json({
      ok: true,
      received: rawItems.length,
      added,
      updated,
      raw_history: rawHistory,
      elapsed_ms: elapsed,
      auto: wantAuto
        ? { scheduled: true }
        : { scheduled: false, reason: autoEnabled() ? 'body.auto=false' : 'AUTO_PIPELINE=0' },
    });
  } catch (e: any) {
    console.error('❌ [ingest POST]', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET — สำหรับหน้า Ingestion
// ═══════════════════════════════════════════════════════════════
export async function GET() {
  try {
    const { data: logs } = await supabase
      .from('ingest_logs')
      .select('*')
      .order('at', { ascending: false })
      .limit(100);

    const [totalRes, pendingRes, approvedRes] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    ]);

    return NextResponse.json({
      count: logs?.length || 0,
      log: logs || [],
      stats: {
        total: totalRes.count || 0,
        pending: pendingRes.count || 0,
        approved: approvedRes.count || 0,
        rejected: 0,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}