-- ═══════════════════════════════════════════════════════════════
-- Audience เป็น evidence + base attributes ต้องมี provenance
-- ═══════════════════════════════════════════════════════════════
-- หลักการ:
--  - enrichment.audiences ถูกเพิ่มเป็น attribute "audience" ฝั่ง evidence
--  - ทุกค่า source='evidence' ต้องมี evidence ไม่ว่าง (เดิม base เป็น NULL)
--  - ไม่แตะตาราง products / attribute_overrides / manual edits
-- ย้อนกลับ: รัน CREATE OR REPLACE VIEW จาก migration 20261103150000
-- ═══════════════════════════════════════════════════════════════

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
    ('space', 'spaces'),
    ('audience', 'audiences')
  ) AS k(attr, key)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.enrichment->k.key, '[]'::jsonb)) AS t(tag)
  WHERE NOT (COALESCE(p.attribute_overrides, '{}'::jsonb) ? k.attr)
    -- ค่า evidence ต้องตรวจย้อนได้
    AND jsonb_array_length(COALESCE(t.tag->'evidence', '[]'::jsonb)) > 0
),
base AS (
  SELECT
    p.id AS product_id, p.ext, x.attr AS attribute,
    x.val AS value_id, x.val AS value_label,
    'evidence'::text AS source, 1::numeric AS confidence,
    jsonb_build_array(jsonb_build_object('field', x.attr, 'value', x.val)) AS evidence,
    NULL::boolean AS grounded,
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
