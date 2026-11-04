-- ═══════════════════════════════════════════════════════════════
-- Review workbench: ค่าที่คนแก้ (manual) แยกจากหลักฐาน/คำนวณ/AI
-- ═══════════════════════════════════════════════════════════════
-- หลักการ:
--  - admin แก้ attribute ได้ → เก็บใน attribute_overrides (JSONB) ไม่ทับ enrichment
--    เพราะ enrichment ถูกคำนวณใหม่ทุกครั้งที่ pipeline รัน
--  - admin แก้ฟิลด์สินค้า (ชื่อ/ราคา/ประเภท/แบรนด์/จังหวัด/description)
--    → เก็บ manual_edits เป็น "รายชื่อคีย์ที่ถูกแก้" เพื่อให้ apply ไม่เขียนทับ
--  - product_attributes: เพิ่ม source ที่ 4 = 'manual' และซ่อนค่าที่ถูก override
--    (ยังเป็น view เดียว ไม่คัดลอกข้อมูล)
-- ปลอดภัย: เพิ่มคอลัมน์ nullable เท่านั้น ไม่ลบ/เปลี่ยนชื่อคอลัมน์เดิม
-- ย้อนกลับ: ALTER TABLE ... DROP COLUMN attribute_overrides, manual_edits;
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS attribute_overrides JSONB,
  ADD COLUMN IF NOT EXISTS manual_edits        JSONB;

COMMENT ON COLUMN public.products.attribute_overrides IS
  'admin override ต่อ attribute: {"context":{"values":[{"value_id":"kitchen","label":"ห้องครัว"}],"at":"...","by":"admin"}}';
COMMENT ON COLUMN public.products.manual_edits IS
  'คีย์ที่ admin แก้เอง: {"name":{"at":"..."}} — pipeline ต้องไม่เขียนทับคีย์เหล่านี้';

CREATE INDEX IF NOT EXISTS products_attribute_overrides_idx
  ON public.products USING gin (attribute_overrides);

CREATE INDEX IF NOT EXISTS products_manual_edits_idx
  ON public.products (id) WHERE manual_edits IS NOT NULL;

-- ── Product Attributes (long format) + source 'manual' ─────────
-- attribute ids: category, product_type, brand, province,
--   use_case, function, context, style, space,
--   audience, occasion, adjustability, power_source, assembly, finish,
--   size, target_context, price_segment
CREATE OR REPLACE VIEW public.product_attributes AS
WITH evidence AS (
  SELECT
    p.id AS product_id,
    p.ext,
    k.attr AS attribute,
    COALESCE(t.tag->>'id', '') AS value_id,
    COALESCE(t.tag->>'value', '') AS value_label,
    'evidence'::text AS source,
    COALESCE((t.tag->>'confidence')::numeric, 1) AS confidence,
    t.tag->'evidence' AS evidence,
    NULL::boolean AS grounded,
    NULL::boolean AS conflict,
    NULL::text AS ai_model
  FROM public.products p
  CROSS JOIN (VALUES
    ('use_case', 'use_cases'),
    ('function', 'functions'),
    ('context', 'contexts'),
    ('style', 'styles'),
    ('space', 'spaces')
  ) AS k(attr, key)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.enrichment->k.key, '[]'::jsonb)) AS t(tag)
  WHERE NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? k.attr)
),
base AS (
  SELECT
    p.id AS product_id, p.ext, x.attr AS attribute,
    x.val AS value_id, x.val AS value_label,
    'evidence'::text AS source, 1::numeric AS confidence,
    NULL::jsonb AS evidence, NULL::boolean AS grounded,
    NULL::boolean AS conflict, NULL::text AS ai_model
  FROM public.products p
  CROSS JOIN LATERAL (
    -- หมายเหตุ: ตาราง products ไม่มีคอลัมน์ category (มี product_type)
    -- attribute "category" ยังอยู่ในชุดมาตรฐานผ่าน API/export (คำนวณใน memory)
    SELECT 'product_type'::text AS attr, p.product_type::text AS val
    UNION ALL SELECT 'brand', p.brand::text
    UNION ALL SELECT 'province', NULLIF(p.province, 'ไม่ระบุ')::text
  ) AS x
  WHERE x.val IS NOT NULL AND x.val <> ''
    AND NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? x.attr)
),
computed AS (
  SELECT
    p.id AS product_id, p.ext, 'size'::text AS attribute,
    p.size_label AS value_id, p.size_label AS value_label,
    'computed'::text AS source, 1::numeric AS confidence,
    jsonb_build_array(jsonb_build_object(
      'width_cm', p.width_cm, 'depth_cm', p.depth_cm, 'height_cm', p.height_cm
    )) AS evidence,
    NULL::boolean AS grounded, NULL::boolean AS conflict, NULL::text AS ai_model
  FROM public.products p
  WHERE p.size_label IS NOT NULL
    AND NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? 'size')

  UNION ALL
  SELECT
    p.id, p.ext, 'target_context',
    COALESCE(t.tag->>'id', ''), COALESCE(t.tag->>'value', ''),
    'computed', COALESCE((t.tag->>'confidence')::numeric, 0.5),
    t.tag->'evidence', NULL, NULL, NULL
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.enrichment->'target_contexts', '[]'::jsonb)) AS t(tag)
  WHERE NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? 'target_context')

  UNION ALL
  SELECT
    p.id, p.ext, 'price_segment',
    COALESCE(p.enrichment->'price_segment'->>'label', ''),
    COALESCE(p.enrichment->'price_segment'->>'label', ''),
    'computed', 1::numeric,
    jsonb_build_array(jsonb_build_object(
      'basis', p.enrichment->'price_segment'->>'basis',
      'percentile', p.enrichment->'price_segment'->>'percentile',
      'sample', p.enrichment->'price_segment'->>'sample',
      'median', p.enrichment->'price_segment'->>'median'
    )),
    NULL, NULL, NULL
  FROM public.products p
  WHERE COALESCE(p.enrichment->'price_segment'->>'label', '') NOT IN ('', 'Unknown')
    AND NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? 'price_segment')
),
ai AS (
  SELECT
    p.id AS product_id, p.ext,
    t.tag->>'attribute' AS attribute,
    t.tag->>'value_id' AS value_id,
    t.tag->>'value' AS value_label,
    'ai_inferred'::text AS source,
    COALESCE((t.tag->>'confidence')::numeric, 0) AS confidence,
    CASE WHEN t.tag ? 'quote' THEN jsonb_build_array(t.tag->>'quote') ELSE '[]'::jsonb END AS evidence,
    COALESCE((t.tag->>'grounded')::boolean, false) AS grounded,
    COALESCE((t.tag->>'conflict')::boolean, false) AS conflict,
    p.ai_enrichment->'meta'->>'model' AS ai_model
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.ai_enrichment->'tags', '[]'::jsonb)) AS t(tag)
  WHERE NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? (t.tag->>'attribute'))
),
manual AS (
  SELECT
    p.id AS product_id, p.ext,
    o.key AS attribute,
    COALESCE(v.val->>'value_id', '') AS value_id,
    COALESCE(v.val->>'label', v.val->>'value_id', '') AS value_label,
    'manual'::text AS source,
    1::numeric AS confidence,
    CASE
      WHEN NULLIF(o.value->>'note', '') IS NOT NULL THEN jsonb_build_array(o.value->>'note')
      ELSE '[]'::jsonb
    END AS evidence,
    NULL::boolean AS grounded,
    NULL::boolean AS conflict,
    NULL::text AS ai_model
  FROM public.products p
  CROSS JOIN LATERAL jsonb_each(COALESCE(p.attribute_overrides, '{}'::jsonb)) AS o(key, value)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.value->'values', '[]'::jsonb)) AS v(val)
)
SELECT * FROM manual
UNION ALL SELECT * FROM evidence
UNION ALL SELECT * FROM base
UNION ALL SELECT * FROM computed
UNION ALL SELECT * FROM ai;

GRANT SELECT ON public.product_attributes TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
