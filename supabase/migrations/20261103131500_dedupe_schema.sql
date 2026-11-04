-- ═══════════════════════════════════════════════════════════════
-- Dedupe schema — 1 ความหมาย = 1 คอลัมน์ / 1 ที่เก็บ
-- ═══════════════════════════════════════════════════════════════
-- ที่มา: ตาราง products มีคอลัมน์ชื่อซ้ำความหมาย 6 คู่, payload ถูกเก็บ
-- 3 ชั้น (raw_products.payload + products._raw + คอลัมน์ที่ map แล้ว)
-- และมีตารางที่แอปไม่เคยเขียนเลย 5 ตัว
--
-- การจับคู่ที่ใช้:
--   trust       t        → trust_score
--   commission  cm       → commission_per_unit
--   status      st (ไทย) → status (รหัส)  — ป้ายไทยแปลงที่ API
--   category    cat      → product_type    — cat ดิบยังอยู่ใน raw payload
--   province    location → province        — ที่อยู่ดิบยังอยู่ใน raw payload
--   payload     _raw     → raw_products.payload (กุญแจ ext)
--
-- ปลอดภัย: ตาราง products ว่าง 0 แถว ณ วันที่เขียน และทุกคอลัมน์ที่ลบ
-- กู้คืนได้จาก raw_products.payload (61 แถว) — ไม่มีการลบข้อมูลดิบ
-- ═══════════════════════════════════════════════════════════════

-- ── 1) products: ลบคอลัมน์ซ้ำ/ตาย ─────────────────────────────
ALTER TABLE public.products DROP COLUMN IF EXISTS _raw;              -- ซ้ำกับ raw_products.payload
ALTER TABLE public.products DROP COLUMN IF EXISTS cat;               -- ซ้ำกับ product_type
ALTER TABLE public.products DROP COLUMN IF EXISTS t;                 -- ซ้ำกับ trust_score
ALTER TABLE public.products DROP COLUMN IF EXISTS cm;                -- ซ้ำกับ commission_per_unit
ALTER TABLE public.products DROP COLUMN IF EXISTS st;                -- ซ้ำกับ status
ALTER TABLE public.products DROP COLUMN IF EXISTS location;          -- ซ้ำกับ province
ALTER TABLE public.products DROP COLUMN IF EXISTS first_ingested_at; -- ซ้ำกับ ingested_at
ALTER TABLE public.products DROP COLUMN IF EXISTS shop_icon;         -- ไม่มีโค้ดอ่าน/เขียน

-- ── 2) raw_products: 4 เวลา → 2 เวลา ─────────────────────────
-- created_at / processed_at / first_seen_at / last_seen_at เคยมีค่า
-- เท่ากันทั้ง 4 (ingest เขียน created_at ทับทุกครั้ง) จึงเหลือ
-- "เห็นครั้งแรก" กับ "เห็นล่าสุด" เท่านั้น
ALTER TABLE public.raw_products DROP COLUMN IF EXISTS created_at;
ALTER TABLE public.raw_products DROP COLUMN IF EXISTS processed_at;

UPDATE public.raw_products
   SET first_seen_at = COALESCE(first_seen_at, last_seen_at, now()),
       last_seen_at  = COALESCE(last_seen_at, first_seen_at, now())
 WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

ALTER TABLE public.raw_products ALTER COLUMN first_seen_at SET DEFAULT now();
ALTER TABLE public.raw_products ALTER COLUMN last_seen_at SET DEFAULT now();
ALTER TABLE public.raw_products ALTER COLUMN first_seen_at SET NOT NULL;
ALTER TABLE public.raw_products ALTER COLUMN last_seen_at SET NOT NULL;

-- นับจำนวนครั้งที่ payload เปลี่ยน + อัปเดต last_seen_at อัตโนมัติ
CREATE OR REPLACE FUNCTION public.raw_products_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.last_seen_at := now();
  NEW.version := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_products_touch ON public.raw_products;
CREATE TRIGGER trg_raw_products_touch
  BEFORE UPDATE OF payload ON public.raw_products
  FOR EACH ROW
  EXECUTE FUNCTION public.raw_products_touch();

-- ── 3) ตารางที่ไม่มีโค้ดเขียน/อ่าน → ลบ ────────────────────────
-- ประวัติ graph/price/raw เก็บเป็น JSONL ใน data/network/ อยู่แล้ว
-- (ถ้าจะย้ายประวัติเข้า DB ทีหลัง ให้สร้างตารางใหม่พร้อมโค้ดที่เขียนจริง)
DROP TABLE IF EXISTS public.price_observations;
DROP TABLE IF EXISTS public.raw_product_versions;
DROP TABLE IF EXISTS public.network_edges;
DROP TABLE IF EXISTS public.network_nodes;
DROP TABLE IF EXISTS public.network_runs;

NOTIFY pgrst, 'reload schema';
