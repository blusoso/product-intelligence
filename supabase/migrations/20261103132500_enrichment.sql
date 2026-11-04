-- ═══════════════════════════════════════════════════════════════
-- Product Understanding & Enrichment
-- ═══════════════════════════════════════════════════════════════
-- เก็บผล "ตีความสินค้า" ไว้ที่เดียวเป็น JSONB (ไม่แยกคอลัมน์ซ้ำ):
--   use_cases / functions / contexts / styles / spaces / target_contexts
--   + price_segment (label, basis, percentile, sample, median)
-- ทุกค่าในนั้นมี evidence + confidence ติดไปด้วย
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS enrichment JSONB;

COMMENT ON COLUMN public.products.enrichment IS
  'Product Understanding & Enrichment: use case/function/context/style/space/target context/price segment พร้อม evidence และ confidence';

-- ค้นหา/กรองด้วย use case หรือ context ได้จาก SQL
CREATE INDEX IF NOT EXISTS idx_products_enrichment
  ON public.products USING GIN (enrichment jsonb_path_ops);

NOTIFY pgrst, 'reload schema';
