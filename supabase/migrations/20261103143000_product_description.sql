-- ═══════════════════════════════════════════════════════════════
-- เก็บ description ของสินค้า (ข้อความจริงจาก payload)
-- ═══════════════════════════════════════════════════════════════
-- เหตุผล: AI enrichment / backfill ต้องการข้อความบรรยายสินค้า
-- แม้ raw_products จะถูกล้างไปแล้ว — description เป็นข้อความจริง
-- ไม่ใช่ค่าที่ AI สร้าง จึงเก็บได้โดยไม่ขัดหลัก "แยกหลักฐาน/AI"
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.products.description IS
  'ข้อความบรรยายสินค้าจาก marketplace (ตัด 4000 ตัวอักษร) — ใช้เป็นหลักฐานตอนทำ AI enrichment';

NOTIFY pgrst, 'reload schema';
