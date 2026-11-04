-- ═══════════════════════════════════════════════════════════════
-- Trust Risk — risk จากรีวิว/นโยบายร้าน/ความพร้อมขาย
-- ═══════════════════════════════════════════════════════════════
-- ค่าเหล่านี้คำนวณในโค้ด (deterministic) แล้ว sync กลับมาเก็บไว้เพื่อ
-- query ด้วย SQL / BI — ไม่ใช่คะแนน popularity จาก datasource
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS risk_flags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS risk_metrics JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_risk_level_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_risk_level_check
  CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high'));

CREATE INDEX IF NOT EXISTS idx_products_risk_level
  ON public.products(risk_level)
  WHERE risk_level IS NOT NULL;

COMMENT ON COLUMN public.products.tier IS
  'Tier จาก datasource เช่น PROVEN/GEM — popularity tier ไม่ใช่ trust ภายใน';
COMMENT ON COLUMN public.products.opportunity_class IS
  'Internal tier: proven | hidden | emerging (คำนวณจาก graph + demand + audience fit + trust)';
COMMENT ON COLUMN public.products.risk_flags IS
  'risk flags จากรีวิว/นโยบายร้าน/ความสอดคล้องของข้อมูล';
COMMENT ON COLUMN public.products.risk_level IS
  'ระดับความเสี่ยง low | medium | high (ไม่ใช่ popularity)';
COMMENT ON COLUMN public.products.risk_metrics IS
  'รายละเอียด risk: damage_mentions, policy, availability, sold consistency พร้อม quote';

NOTIFY pgrst, 'reload schema';
