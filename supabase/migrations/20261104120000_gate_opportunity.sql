-- ═══════════════════════════════════════════════════════════════
-- Trust Gate + Opportunity (Proven / Hidden / Emerging)
-- ═══════════════════════════════════════════════════════════════
-- ค่าเหล่านี้คำนวณในโค้ด (deterministic) แล้ว sync กลับมาเก็บไว้เพื่อ
-- query ด้วย SQL / BI — ไม่ใช่ตาราง node/edge ของ graph
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gate_status TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gate_reasons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gate_checked_at TIMESTAMPTZ;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS opportunity_class TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS opportunity_metrics JSONB DEFAULT '{}'::jsonb;

-- เวลาที่ระบบเห็น listing ครั้งแรก — ใช้ตัดสิน Emerging เมื่อ listing_age_days ไม่มี
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;

-- backfill จาก raw_products (แหล่งความจริงของ "เห็นครั้งแรก")
UPDATE public.products p
   SET first_seen_at = r.first_seen_at
  FROM public.raw_products r
 WHERE r.ext = p.ext
   AND p.first_seen_at IS NULL
   AND r.first_seen_at IS NOT NULL;

ALTER TABLE public.products ALTER COLUMN first_seen_at SET DEFAULT now();

-- gate_status: pass | review | blocked
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_gate_status_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_gate_status_check
  CHECK (gate_status IS NULL OR gate_status IN ('pass', 'review', 'blocked'));

-- opportunity_class: proven | hidden | emerging
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_opportunity_class_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_opportunity_class_check
  CHECK (opportunity_class IS NULL OR opportunity_class IN ('proven', 'hidden', 'emerging'));

CREATE INDEX IF NOT EXISTS idx_products_gate_status ON public.products(gate_status);
CREATE INDEX IF NOT EXISTS idx_products_opportunity_class
  ON public.products(opportunity_class)
  WHERE opportunity_class IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_gate_pass
  ON public.products(id)
  WHERE gate_status = 'pass';

COMMENT ON COLUMN public.products.gate_status IS
  'ผล Trust Gate: pass | review | blocked (คำนวณใหม่ทุกรอบ pipeline)';
COMMENT ON COLUMN public.products.gate_reasons IS
  'รหัสเหตุผลที่ทำให้ไม่ผ่าน gate เช่น out_of_stock, stale_data, quality_below_min';
COMMENT ON COLUMN public.products.opportunity_class IS
  'Proven / Hidden / Emerging จาก centrality + demand + audience fit';
COMMENT ON COLUMN public.products.opportunity_metrics IS
  'degree/strength/pagerank/percentile/audience_fit ที่ใช้ตัดสิน (ตรวจย้อนได้)';

NOTIFY pgrst, 'reload schema';
