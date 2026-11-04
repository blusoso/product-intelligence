-- ═══════════════════════════════════════════════════════════════
-- 1) เพิ่มคอลัมน์ที่ขาด (image เป็นต้นเหตุหลัก)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shop_icon TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 2) เพิ่ม index ช่วยให้ filter เร็ว (แนะนำ)
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_ext ON public.products(ext);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(cat);
CREATE INDEX IF NOT EXISTS idx_raw_products_status ON public.raw_products(status);

-- ═══════════════════════════════════════════════════════════════
-- 3) บังคับ Supabase รีโหลด Schema Cache (สำคัญ!)
-- ═══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
-- 4) ตรวจสอบว่าคอลัมน์ครบ
-- ═══════════════════════════════════════════════════════════════
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'products'
ORDER BY ordinal_position;