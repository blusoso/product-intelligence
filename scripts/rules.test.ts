import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCategory, detectProductType } from '../lib/network/taxonomy';
import { enrichProduct } from '../lib/network/enrich';
import { isAmbiguousPhrase } from '../lib/network/phrase-memory';
import { sanitizeAiTags, validateEnrichmentOne } from '../lib/network/validate-enrichment';
import { buildProductAttributes } from '../lib/network/attributes';
import { reconcileWithRules } from '../lib/network/ai';
import { auditKeywords } from '../lib/network/keyword-registry';
import { evaluateGate } from '../lib/network/gate';
import { buildPairEdges } from '../lib/network/projection';
import { buildGraph } from '../lib/network/graph';
import { computeCentrality, computeOpportunities } from '../lib/network/opportunity';
import { deriveTrustRisk } from '../lib/network/trust';
import { flattenRow } from '../lib/network/source';
import type {
  AiTag,
  EnrichedTag,
  GateResult,
  Graph,
  NormalizedProduct,
} from '../lib/network/types';

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

/* ═══════════════════════════════════════════════════════════════
 * Trust Gate / Projection / Opportunity
 * ═══════════════════════════════════════════════════════════════ */

const tag = (id: string, value: string, confidence = 0.8): EnrichedTag => ({
  id,
  value,
  confidence,
  evidence: [`test:${id}`],
});

function emptyEnrichment(over: Record<string, unknown> = {}) {
  return {
    use_cases: [],
    functions: [],
    contexts: [],
    styles: [],
    spaces: [],
    audiences: [],
    target_contexts: [],
    price_segment: { label: 'Mid', basis: 'market', percentile: 0.5, sample: 10, median: 500 },
    ...over,
  } as any;
}

function mkProduct(
  name: string,
  opts: {
    type?: string;
    category?: string;
    enrichment?: any;
    price?: number;
    shop?: string;
    quality?: number;
    sold?: number;
    rating?: number;
    age?: number;
    description?: string;
  } = {},
): NormalizedProduct {
  const p = makeProduct(name, {
    product_type: opts.type ?? 'desk',
    category: opts.category ?? 'furniture',
    enrichment: opts.enrichment ?? emptyEnrichment(),
  });
  p.price = opts.price ?? 500;
  p.shop_id = opts.shop ?? 'shop-a';
  p.shop_name = opts.shop ?? 'shop-a';
  p.quality_score = opts.quality ?? 90;
  p.historical_sold = opts.sold ?? 1000;
  p.rating = opts.rating ?? 4.7;
  p.listing_age_days = opts.age === undefined ? 200 : opts.age;
  p.description = opts.description ?? '';
  p.url = `https://shopee.co.th/${encodeURIComponent(name)}`;
  p.ingested_at = '2026-11-04T00:00:00.000Z';
  return p;
}

const gateResult = (status: GateResult['status']): GateResult => ({
  status,
  reasons: [],
  checks: [],
  checked_at: '2026-11-04T00:00:00.000Z',
});

test('trust risk: รีวิวเสียหาย/นโยบายร้าน/ negation/ claim support', () => {
  const damageReviews = Array.from({ length: 6 }, (_, i) => ({
    rating_star: i < 4 ? 1 : 2,
    comment: `ได้รับสินค้าแล้ว มีรอยแตกและน็อตหลุด ครั้งที่ ${i + 1}`,
  }));

  const strict = deriveTrustRisk({
    description:
      'หากลูกค้ากดยืนยันรับสินค้าแล้ว ทางร้านขอสงวนสิทธิ์ในการเคลมสินค้าหลังจากกดยืนยันรับสินค้าทุกกรณี',
    reviews: damageReviews,
  });
  assert.equal(strict.policy.strict_return, true);
  assert.equal(strict.level, 'high');
  assert.ok(strict.flags.includes('severe_damage_cluster'));
  assert.ok(strict.review.damage_mentions >= 5);

  const mitigated = deriveTrustRisk({
    description: 'สินค้ามีประกัน 1 ปี เคลมเร็วส่งใหม่ให้ภายใน 30 วัน',
    reviews: damageReviews,
  });
  assert.equal(mitigated.policy.claim_support, true);
  assert.equal(mitigated.policy.strict_return, false);
  assert.equal(mitigated.level, 'medium');

  const negated = deriveTrustRisk({
    reviews: [{ rating_star: 1, comment: 'สภาพดีมาก ไม่มีรอยแตก ไม่พบสนิม' }],
  });
  assert.equal(negated.review.damage_mentions, 0);

  const colorChange = deriveTrustRisk({
    description:
      'ไม่รับเปลี่ยนสี/ที่อยู่ ในแชท กรุณาตรวจสอบก่อนสั่ง เช็คสินค้าก่อนกดยืนยันการรับสินค้าทุกครั้ง',
  });
  assert.equal(colorChange.policy.strict_return, false);
});

test('trust gate: unavailable/sold inconsistency บล็อก, strict policy เป็น review', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  const p = mkProduct('โต๊ะเสี่ยง');
  p.is_unavailable = true;
  assert.equal(evaluateGate(p, { now }).status, 'blocked');
  assert.ok(evaluateGate(p, { now }).checks.some((c) => c.id === 'unavailable'));

  p.is_unavailable = false;
  p.quality_flags = ['sold_inconsistent'];
  assert.equal(evaluateGate(p, { now }).status, 'blocked');
  p.quality_flags = [];

  p.trust_risk = deriveTrustRisk({
    description: 'หลังกดยืนยันรับสินค้า ทางร้านไม่สามารถเคลมสินค้าใหม่ให้ได้',
  });
  const gate = evaluateGate(p, { now });
  assert.equal(gate.status, 'review');
  assert.ok(gate.risk_flags?.includes('strict_return_policy'));
});

test('source: empty JSONB จาก DB ต้องไม่กลบ raw reviews', () => {
  const merged = flattenRow(
    { reviews: [], rating_dist: {}, name: 'DB row' },
    { reviews: [{ rating_star: 1, comment: 'โต๊ะแตก' }], rating_dist: { total: 1, s1: 1 }, name: 'raw' },
  );
  assert.equal(merged.name, 'DB row');
  assert.equal(merged.reviews.length, 1);
  assert.equal(merged.rating_dist.total, 1);
});

test('gate: blocked (identity/price/quality/stock) และ review (flag/stale/url)', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  const p = mkProduct('โต๊ะทำงานไม้');
  assert.equal(evaluateGate(p, { now }).status, 'pass');

  p.price = 0;
  assert.equal(evaluateGate(p, { now }).status, 'blocked');
  p.price = 500;

  p.quality_score = 40;
  assert.equal(evaluateGate(p, { now }).status, 'blocked');
  p.quality_score = 90;

  p.in_stock = false;
  assert.equal(evaluateGate(p, { now }).status, 'blocked');
  p.in_stock = true;

  p.quality_flags = ['encoding_repaired'];
  assert.equal(evaluateGate(p, { now }).status, 'review');
  p.quality_flags = [];

  p.ingested_at = '2026-10-01T00:00:00.000Z';
  assert.equal(evaluateGate(p, { now }).status, 'review');
  p.ingested_at = now.toISOString();

  p.url = '';
  assert.equal(evaluateGate(p, { now }).status, 'review');
});

test('projection: similar/substitute ต้องผ่าน attribute overlap และมี evidence', () => {
  const groups = emptyEnrichment({
    functions: [tag('surface', 'พื้นผิว')],
    contexts: [tag('bedroom', 'ห้องนอน')],
    use_cases: [tag('desk_work', 'ทำงาน')],
  });

  const a = mkProduct('โต๊ะทำงานไม้ A', { enrichment: groups, price: 500, shop: 's1' });
  const b = mkProduct('โต๊ะทำงานไม้ B', { enrichment: groups, price: 900, shop: 's2' });
  const same = mkProduct('โต๊ะทำงานเหล็ก C', { enrichment: groups, price: 500, shop: 's3' });
  const sparse = mkProduct('โต๊ะทำงานไม้ D', {
    enrichment: emptyEnrichment({ functions: [tag('surface', 'พื้นผิว')] }),
    price: 500,
    shop: 's4',
  });

  const edges = buildPairEdges([a, b, same, sparse]);
  const pairKey = (x: NormalizedProduct, y: NormalizedProduct) =>
    [x.node_key, y.node_key].sort().join('||');
  const find = (x: NormalizedProduct, y: NormalizedProduct) =>
    edges.find((e) => pairKey(x, y) === [e.source, e.target].sort().join('||'));

  const ab = find(a, b);
  assert.ok(ab, 'คู่ที่ overlap ครบต้องมี edge');
  assert.equal(ab!.type, 'similar_to');

  const ac = find(a, same);
  assert.ok(ac, 'คู่ราคาเดียวกัน คนละร้าน ควรเป็น substitute');
  assert.equal(ac!.type, 'substitute');

  assert.equal(find(a, sparse), undefined, 'overlap ต่ำกว่าเกณฑ์ต้องไม่มี edge');

  for (const e of edges) {
    assert.ok(e.evidence && Object.keys(e.evidence).length > 0, `${e.type} ไม่มี evidence`);
    assert.ok(e.evidence.basis, `${e.type} ไม่มี shared basis`);
  }
});

test('projection: complements / same_context / used_with', () => {
  const deskUse = emptyEnrichment({
    use_cases: [tag('study', 'อ่านหนังสือ/เรียน')],
    contexts: [tag('bedroom', 'ห้องนอน')],
  });
  const lampUse = emptyEnrichment({
    use_cases: [tag('study', 'อ่านหนังสือ/เรียน')],
    contexts: [tag('bedroom', 'ห้องนอน')],
  });
  const desk = mkProduct('โต๊ะทำงานไม้', { type: 'desk', enrichment: deskUse, price: 500, shop: 's1' });
  const lamp = mkProduct('โคมไฟตั้งโต๊ะ', { type: 'lamp', enrichment: lampUse, price: 300, shop: 's2' });
  const comp = buildPairEdges([desk, lamp]);
  assert.ok(comp.some((e) => e.type === 'complements'), 'ต่างประเภท + use case ร่วม ต้องได้ complements');
  assert.ok(!comp.some((e) => e.type === 'same_context'), 'มี use case ร่วมแล้วไม่ควรมี same_context ซ้ำ');

  const deskCtx = mkProduct('โต๊ะวางของ', {
    type: 'desk',
    enrichment: emptyEnrichment({
      use_cases: [tag('desk_work', 'ทำงาน')],
      contexts: [tag('bedroom', 'ห้องนอน')],
    }),
    price: 500,
    shop: 's3',
  });
  const lampCtx = mkProduct('โคมไฟหัวเตียง', {
    type: 'lamp',
    enrichment: emptyEnrichment({ contexts: [tag('bedroom', 'ห้องนอน')] }),
    price: 300,
    shop: 's4',
  });
  const ctx = buildPairEdges([deskCtx, lampCtx]);
  const sameCtx = ctx.filter((e) => e.type === 'same_context');
  assert.equal(sameCtx.length, 1, 'บริบทเดียวกัน + ไม่มี use case ร่วม ต้องได้ same_context');
  assert.deepEqual(sameCtx[0].evidence.shared_contexts, ['ห้องนอน']);

  const deskBundle = mkProduct('โต๊ะทำงานพร้อมชั้นวาง', {
    type: 'desk',
    enrichment: deskUse,
    price: 500,
    shop: 's5',
    description: 'ใช้คู่กับโคมไฟตั้งโต๊ะในชุดเดียวกัน',
  });
  const lampBundle = mkProduct('โคมไฟตั้งโต๊ะ', {
    type: 'lamp',
    enrichment: lampUse,
    price: 300,
    shop: 's6',
  });
  const bundled = buildPairEdges([deskBundle, lampBundle]);
  const usedWith = bundled.find((e) => e.type === 'used_with');
  assert.ok(usedWith, 'มีวลี "ใช้คู่กับ" + บริบท/use case ร่วม ต้องได้ used_with');
  assert.equal(usedWith!.evidence.quote, 'ใช้คู่กับ');

  const noBundle = buildPairEdges([
    desk,
    mkProduct('โคมไฟตั้งโต๊ะ 2', { type: 'lamp', enrichment: lampUse, price: 300, shop: 's7' }),
  ]);
  assert.ok(!noBundle.some((e) => e.type === 'used_with'), 'ไม่มีวลีห้ามสร้าง used_with');
});

test('graph: enrichment.audiences → audience node + targets_audience edge', () => {
  const p = mkProduct('โต๊ะทำงานนักศึกษา', {
    enrichment: emptyEnrichment({ audiences: [tag('student', 'นักศึกษา')] }),
  });
  const g = buildGraph([p]);
  assert.ok(g.nodes.some((n) => n.id === 'aud:student' && n.type === 'audience'));
  assert.ok(
    g.edges.some(
      (e) => e.type === 'targets_audience' && e.source === p.node_key && e.target === 'aud:student',
    ),
  );
});

test('opportunity: Proven / Hidden / Emerging + blocked ถูกตัดออก', () => {
  const a = mkProduct('โต๊ะทำงาน A', {
    enrichment: emptyEnrichment({
      contexts: [tag('small_space', 'พื้นที่เล็ก')],
      audiences: [tag('student', 'นักศึกษา')],
    }),
    sold: 50000,
    rating: 4.9,
  });
  const b = mkProduct('โต๊ะทำงาน B', { sold: 30000, rating: 4.8 });
  const c = mkProduct('โคมไฟ C', {
    enrichment: emptyEnrichment({ audiences: [tag('student', 'นักศึกษา', 0.9)] }),
    sold: 1000,
    rating: 4.8,
  });
  const d = mkProduct('เก้าอี้ D', {
    enrichment: emptyEnrichment({ contexts: [tag('small_space', 'พื้นที่เล็ก')] }),
    sold: 5000,
    rating: 4.6,
    age: 10,
  });
  const e = mkProduct('สินค้าต้องห้าม E', { sold: 0, rating: 4.0 });
  d.monthly_sold = 3000;
  d.review_count = 10;
  a.datasource_tier = 'GEM';

  a.gate = gateResult('pass');
  b.gate = gateResult('pass');
  c.gate = gateResult('pass');
  d.gate = gateResult('pass');
  e.gate = gateResult('blocked');

  const products = [a, b, c, d, e];
  const nodes = products.map((p) => ({
    id: p.node_key,
    type: 'product' as const,
    label: p.name,
    weight: 1,
    attributes: {},
  }));
  const edge = (x: NormalizedProduct, y: NormalizedProduct) => ({
    id: `similar_to|${x.node_key}|${y.node_key}`,
    source: x.node_key,
    target: y.node_key,
    type: 'similar_to' as const,
    weight: 0.9,
    directed: false,
    evidence: { basis: 'shared_context' },
  });
  const graph: Graph = {
    directed: false,
    generated_at: '2026-11-04T00:00:00.000Z',
    nodes,
    edges: [edge(a, b), edge(a, c), edge(a, d)],
    stats: {} as any,
  };

  const report = computeOpportunities(products, graph);
  const byKey = new Map(report.items.map((o) => [o.node_key, o]));
  assert.equal(byKey.get(a.node_key)?.class, 'proven');
  assert.equal(byKey.get(a.node_key)?.internal_tier, 'proven');
  assert.equal(byKey.get(a.node_key)?.datasource_tier, 'GEM');
  assert.equal(byKey.get(c.node_key)?.class, 'hidden');
  assert.equal(
    byKey.get(d.node_key)?.class,
    'emerging',
    'สินค้าอายุ <30 วันต้องเป็น Emerging แม้ยอดขาย/degree จะพอเป็น Proven',
  );
  assert.equal(byKey.get(e.node_key), undefined, 'gate blocked ต้องไม่ถูกจัดอันดับ');

  for (const item of report.items) {
    assert.ok(item.explain_th.length > 0, 'ทุกผลต้องมีคำอธิบาย');
    assert.ok(item.evidence.length > 0, 'ทุกผลต้องมี evidence');
    assert.ok(item.metrics.audience_fit >= 0);
  }
  assert.equal(report.gate_counts.pass, 4);
  assert.equal(report.gate_counts.review, 0);
  assert.equal(report.gate_counts.blocked, 1);
  assert.equal(report.diagnostics.risk_counts.high, 0);
});

test('pagerank: ผลรวม ≈ 1 และคำนวณซ้ำได้', () => {
  const products = [mkProduct('A'), mkProduct('B'), mkProduct('C')];
  const edges = [
    {
      id: 'e1',
      source: products[0].node_key,
      target: products[1].node_key,
      type: 'similar_to' as const,
      weight: 0.8,
      directed: false,
      evidence: {},
    },
    {
      id: 'e2',
      source: products[1].node_key,
      target: products[2].node_key,
      type: 'similar_to' as const,
      weight: 0.5,
      directed: false,
      evidence: {},
    },
  ];
  const first = computeCentrality(products.map((p) => p.node_key), edges);
  const second = computeCentrality(products.map((p) => p.node_key), edges);
  let sum = 0;
  for (const v of first.values()) sum += v.pagerank;
  assert.ok(Math.abs(sum - 1) < 0.01, `ผลรวม pagerank = ${sum}`);
  for (const [k, v] of first) assert.equal(v.pagerank, second.get(k)!.pagerank);
});
