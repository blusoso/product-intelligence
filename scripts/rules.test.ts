import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCategory, detectProductType } from '../lib/network/taxonomy';
import { enrichProduct } from '../lib/network/enrich';
import { isAmbiguousPhrase } from '../lib/network/phrase-memory';
import { sanitizeAiTags, validateEnrichmentOne } from '../lib/network/validate-enrichment';
import { buildProductAttributes } from '../lib/network/attributes';
import { reconcileWithRules } from '../lib/network/ai';
import { auditKeywords } from '../lib/network/keyword-registry';
import type { AiTag, NormalizedProduct } from '../lib/network/types';

function makeProduct(
  name: string,
  opts: {
    product_type?: string;
    category?: string;
    enrichment?: any;
    ai?: any;
    province?: string;
  } = {},
): NormalizedProduct {
  const enrichment =
    opts.enrichment ??
    enrichProduct({
      name,
      specs: [],
      options: [],
      category: opts.category ?? 'furniture',
      product_type: opts.product_type ?? 'other',
    });
  return {
    node_key: name,
    ext: `test:${name}`,
    product_id: '1',
    shop_id: '1',
    platform: 'shopee',
    shop_name: 'test',
    name,
    name_raw: name,
    name_tokens: [],
    category: opts.category ?? 'furniture',
    category_confidence: 0.8,
    product_type: opts.product_type ?? 'other',
    type_confidence: 0.8,
    brand: 'TestBrand',
    brand_confidence: 0.8,
    brand_evidence: 'name: TestBrand',
    province: opts.province ?? 'กรุงเทพมหานคร',
    region: 'กรุงเทพและปริมณฑล',
    province_evidence: 'location: กรุงเทพมหานคร',
    price: 100,
    price_before_discount: null,
    discount_pct: 0,
    currency: 'THB',
    price_raw_text: '100',
    price_source: 'item',
    width_cm: null,
    depth_cm: null,
    height_cm: null,
    size_label: null,
    size_source: null,
    size_confidence: 0,
    size_options: [],
    variants: [],
    variant_count: 0,
    variant_price_min: null,
    variant_price_max: null,
    variant_axes: [],
    canonical_id: null,
    canonical_confidence: 0,
    canonical_evidence: null,
    listing_count: 1,
    is_primary_listing: true,
    monthly_sold: 0,
    historical_sold: 0,
    rating: null,
    review_count: 0,
    trust_score: 0,
    listing_age_days: null,
    in_stock: true,
    is_ad: false,
    shopee_verified: false,
    url: '',
    image: null,
    images: [],
    title_length: name.length,
    spec_count: 0,
    option_count: 0,
    description: '',
    materials: [],
    colors: [],
    room: null,
    style: null,
    enrichment,
    ai: opts.ai ?? null,
    specs: [],
    features: {} as any,
    quality_score: 0,
    completeness: 0,
    quality_flags: [],
    repaired: [],
    ingested_at: null,
    updated_at: null,
  } as NormalizedProduct;
}

const aiTag = (attribute: string, value_id: string, quote?: string, extra: Partial<AiTag> = {}): AiTag => ({
  attribute: attribute as AiTag['attribute'],
  value_id,
  value: value_id,
  confidence: 0.8,
  grounded: Boolean(quote),
  origin: 'ai',
  evidence_type: 'text',
  ...(quote ? { quote } : {}),
  ...extra,
});

test('product_type: โต๊ะญี่ปุ่นแยกตามฟีเจอร์/บริบท', () => {
  assert.equal(detectProductType('โต๊ะพับ โต๊ะญี่ปุ่น โต๊ะเล็บบนเตียง ปรับระดับได้').id, 'bed_desk');
  assert.equal(detectProductType('โต๊ะญี่ปุ่นนั่งพื้น โต๊ะกลางโซฟา coffee table').id, 'coffee_table');
  assert.equal(detectProductType('Took Lae Dee โต๊ะญี่ปุ่น 40 x 60 เกรดเอ').id, 'table_generic');
  assert.equal(detectProductType('โต๊ะญี่ปุ่นไม่ปรับระดับ').id, 'table_generic');
  assert.equal(detectProductType('โต๊ะญี่ปุ่นไม่สามารถปรับระดับได้').id, 'table_generic');
  assert.notEqual(detectProductType('โต๊ะทำงานปรับระดับ').id, 'bed_desk');
});

test('taxonomy collisions: desk lamp / สีน้ำตาล / กาแฟ / notebook', () => {
  assert.equal(detectProductType('desk lamp').id, 'lamp');
  assert.notEqual(detectProductType('สีน้ำตาล').id, 'paint');
  assert.equal(detectCategory('โต๊ะกาแฟ').id, 'furniture');
  assert.equal(detectProductType('notebook').id, 'laptop');
});

test('style: SEO in title/spec must not create style', () => {
  const title = enrichProduct({ name: 'โต๊ะญี่ปุ่น มินิมอล', specs: [], options: [] });
  assert.equal(title.styles.length, 0);
  const spec = enrichProduct({
    name: 'โต๊ะ',
    specs: [{ name: 'สไตล์', value: 'มินิมอล' }],
    options: [],
  });
  assert.equal(spec.styles.length, 0);
  const loft = enrichProduct({
    name: 'โต๊ะ',
    specs: [{ name: 'สไตล์', value: 'ลอฟท์' }],
    options: [],
  });
  assert.ok(loft.styles.some((s) => s.id === 'loft'));
});

test('use_case: เด็ก → audience, เขียนหนังสือ → writing, ไม่มี baby_care', () => {
  const e = enrichProduct({ name: 'โต๊ะเขียนหนังสือเด็ก', specs: [], options: [] });
  assert.ok(e.use_cases.some((t) => t.id === 'writing'));
  assert.ok(!e.use_cases.some((t) => t.id === 'baby_care'));
  assert.ok(e.audiences.some((t) => t.id === 'kids'));
});

test('heuristics: หมอน/ที่นอน → sleep จาก product_type', () => {
  const e = enrichProduct({
    name: 'หมอน',
    specs: [],
    options: [],
    category: 'home_living',
    product_type: 'pillow',
  });
  assert.ok(e.use_cases.some((t) => t.id === 'sleep'));
  assert.ok(e.contexts.some((t) => t.id === 'bedroom'));
});

test('validateEnrichmentOne: student/study hierarchy + small_space dedupe', () => {
  const p = makeProduct('โต๊ะเรียนนักเรียน', {
    enrichment: {
      use_cases: [{ id: 'study', value: 'การเรียน', confidence: 0.6, evidence: ['ชื่อ: เรียน'] }],
      functions: [],
      contexts: [],
      styles: [],
      spaces: [{ id: 'small_space', value: 'พื้นที่จำกัด', confidence: 0.7, evidence: ['ขนาด: 40x40'] }],
      audiences: [{ id: 'student', value: 'นักเรียน/นักศึกษา', confidence: 0.6, evidence: ['ชื่อ: นักเรียน'] }],
      target_contexts: [
        { id: 'small_space_only', value: 'พื้นที่จำกัด', confidence: 0.6, evidence: ['ขนาด'] },
        { id: 'use_study', value: 'การเรียน', confidence: 0.4, evidence: ['ชื่อ: เรียน'] },
      ],
      price_segment: { label: 'Unknown', basis: 'unknown', percentile: null, sample: 0, median: null },
    },
  });
  validateEnrichmentOne(p);
  assert.equal(p.enrichment.use_cases.some((t) => t.id === 'study'), false);
  assert.equal(p.enrichment.target_contexts.some((t) => t.id === 'small_space_only'), false);
});

test('phrase memory: SEO/type words/vision are blocked', () => {
  assert.equal(isAmbiguousPhrase('โต๊ะญี่ปุ่น', 'style'), true);
  assert.equal(isAmbiguousPhrase('โต๊ะทำงาน', 'use_case'), true);
  assert.equal(isAmbiguousPhrase('อ่านหนังสือ', 'use_case'), false);
  assert.equal(isAmbiguousPhrase('ร่องวางแท็บเล็ต', 'visual_features'), true);
});

test('AI sanitize: SEO style / visual text / reading from เขียนหนังสือ', () => {
  const p = makeProduct('โต๊ะญี่ปุ่น');
  const tags = [
    aiTag('style', 'japanese', 'มินิมอล'),
    aiTag('style', 'minimal', 'สไตล์มินิมอล'),
    aiTag('visual_features', 'tablet_slot', 'ร่องวางแท็บเล็ต'),
    aiTag('use_case', 'reading', 'เขียนหนังสือ'),
    aiTag('use_case', 'baby_care', 'เด็ก'),
  ];
  const out = sanitizeAiTags(tags, p);
  assert.equal(out.length, 0);
});

test('AI reconcile: use_case ที่เสริมกันไม่ถูก mark conflict', () => {
  const p = makeProduct('โต๊ะทำงาน', {
    enrichment: {
      use_cases: [{ id: 'desk_work', value: 'ทำงานโต๊ะ', confidence: 0.6, evidence: ['ชื่อ: ทำงาน'] }],
      functions: [],
      contexts: [],
      styles: [],
      spaces: [],
      audiences: [],
      target_contexts: [],
      price_segment: { label: 'Unknown', basis: 'unknown', percentile: null, sample: 0, median: null },
    },
  });
  const out = reconcileWithRules([aiTag('use_case', 'reading', 'อ่านหนังสือ')], p);
  assert.equal(out.length, 1);
  assert.equal(out[0].conflict, undefined);
});

test('attributes: source=evidence ทุกค่ามี evidence', () => {
  const p = makeProduct('โต๊ะทำงาน');
  const attrs = buildProductAttributes(p);
  for (const attr of attrs) {
    for (const v of attr.values) {
      if (v.source === 'evidence') {
        assert.ok((v.evidence?.length ?? 0) > 0, `${attr.attribute} ${v.value_id} ไม่มี evidence`);
      }
    }
  }
});

test('keyword audit: ทุกคำต้องผ่าน policy', () => {
  const { issues } = auditKeywords();
  assert.deepEqual(issues, []);
});
