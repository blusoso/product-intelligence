-- ═══════════════════════════════════════════════════════════════
-- AI-assisted enrichment — เก็บ "ค่าที่ AI อนุมาน" แยกจาก "หลักฐาน"
-- ═══════════════════════════════════════════════════════════════
-- กติกาสำคัญ:
--  - enrichment   = ค่าที่สกัดได้จากข้อความ (rule) — ตรวจสอบได้
--  - ai_enrichment = ค่าที่ AI เลือกจาก vocabulary (enum) เท่านั้น
--    มี confidence/grounded/quote และ "ไม่มีฟิลด์ตัวเลข/การวัด"
--  - คอลัมน์ข้อเท็จจริง (price/sold/rating/width_cm/...) ไม่มีทางถูก AI เขียน
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ai_enrichment JSONB;

COMMENT ON COLUMN public.products.ai_enrichment IS
  'AI-inferred attributes (vocabulary enum only): use_case/function/context/style/space/audience/occasion/adjustability/power_source/assembly/finish + confidence, grounded, quote. ห้ามใช้แทนข้อมูลที่ตรวจสอบได้';

CREATE INDEX IF NOT EXISTS idx_products_ai_enrichment
  ON public.products USING GIN (ai_enrichment jsonb_path_ops);

NOTIFY pgrst, 'reload schema';
