/**
 * Product Understanding & Enrichment
 * ----------------------------------
 * เปลี่ยน "ชื่อ + สเปก + ตัวเลือก" ให้เป็นค่าที่ตีความแล้ว:
 *   use case (ใช้ทำอะไร) · function (ทำหน้าที่อะไร) · context (ใช้ที่ไหน)
 *   style (สไตล์) · space (เหมาะกับพื้นที่แบบไหน) · target context (บริบทเป้าหมาย)
 *   price segment (ช่วงราคาเทียบตลาดของหมวด)
 *
 * หลักการ:
 * - deterministic: dictionary + กติกา ไม่เรียก LLM/ไม่เดามั่ว
 * - multi-label: สินค้าหนึ่งชิ้นมีหลาย use case/context ได้
 * - ทุกค่ามี evidence + confidence และไม่สร้างค่าที่ไม่มีหลักฐาน
 */
import type { EnrichedTag, NormalizedProduct, PriceSegment, ProductEnrichment } from './types';
import { median, quantile, round } from './text';
import { keywordValues, type AttrId } from './vocab';
import { applyHeuristics, type HeuristicAttr } from './heuristics';
import { maskSeoTerms, NEGATION_BEFORE } from './seo-keywords';

interface DictEntry {
  id: string;
  label: string;
  keywords: string[];
}

/** รายการคำค้นของแต่ละ attribute — ดึงจาก vocab กลาง (ค่ามาตรฐานชุดเดียว) */
const dictOf = (attr: AttrId): DictEntry[] =>
  keywordValues(attr).map(({ id, label, keywords }) => ({ id, label, keywords }));

export const USES: DictEntry[] = dictOf('use_case');
export const FUNCTIONS: DictEntry[] = dictOf('function');
export const CONTEXTS: DictEntry[] = dictOf('context');
export const STYLES: DictEntry[] = dictOf('style');
export const SPACES: DictEntry[] = dictOf('space');
export const AUDIENCES: DictEntry[] = dictOf('audience');

/* ── กติกาขนาด → พื้นที่จำกัด ────────────────────────────────── */
const SMALL_FOOTPRINT_CM2 = 1600; // 40×40 ซม.
const MEDIUM_FOOTPRINT_CM2 = 2500; // 50×50 ซม.

const SOURCE_WEIGHT = { title: 0.6, spec: 0.5, option: 0.4 } as const;
type SourceName = keyof typeof SOURCE_WEIGHT;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiWord(kw: string): boolean {
  return /^[a-z0-9][a-z0-9 _-]*$/i.test(kw);
}

/**
 * คำที่ชนกับบริบทอื่นบ่อย ( substring ไทย ) — ถ้าคำที่พบตามด้วยคำเหล่านี้
 * ให้ถือว่าไม่ใช่ความหมายที่ต้องการ เช่น "แต่งหน้าบ้าน" ไม่ใช่ "แต่งหน้า"
 */
const BLOCKED_SUFFIX: Record<string, string[]> = {
  แต่งหน้า: ['บ้าน', 'ต่าง', 'ประตู', 'ร้าน', 'เวที', 'สวน'],
  ปรับระดับ: ['ไม่ได้'],
  พับได้: ['ไม่ได้'],
  กันน้ำ: ['ไม่ได้'],
};

/** คำที่ถูกปฏิเสธด้วย "ไม่/ไม่มี/ไม่ต้อง/without/no" ก่อนหน้า */
function isNegatedAt(haystack: string, idx: number): boolean {
  return NEGATION_BEFORE.test(haystack.slice(Math.max(0, idx - 12), idx));
}

function thaiHit(haystack: string, keyword: string): boolean {
  const blocked = BLOCKED_SUFFIX[keyword];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(keyword, from);
    if (idx < 0) return false;
    if (!isNegatedAt(haystack, idx)) {
      if (!blocked) return true;
      const after = haystack.slice(idx + keyword.length, idx + keyword.length + 5);
      if (!blocked.some((b) => after.startsWith(b))) return true;
    }
    from = idx + keyword.length;
  }
}

/** จับคำแบบคำเต็มสำหรับอังกฤษ (กัน "art" ไปเจอ "part") และแบบ substring สำหรับไทย */
function hit(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (isAsciiWord(kw)) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(kw)}(?![a-z0-9])`, 'gi');
    for (const match of haystack.matchAll(re)) {
      if (!isNegatedAt(haystack, match.index ?? 0)) return true;
    }
    return false;
  }
  return thaiHit(haystack, kw);
}

interface TagHit {
  entry: DictEntry;
  first: { source: SourceName; evidence: string };
  sources: Set<SourceName>;
  hits: number;
}

function collect(
  text: { title: string; spec: string; option: string },
  dict: DictEntry[],
  opts: { sources?: SourceName[]; maskSeo?: boolean } = {},
): EnrichedTag[] {
  const hits = new Map<string, TagHit>();
  const allLayers: Array<[SourceName, string]> = [
    ['title', text.title],
    ['spec', text.spec],
    ['option', text.option],
  ];
  const wanted = new Set<SourceName>(opts.sources ?? ['title', 'spec', 'option']);
  const layers = allLayers
    .filter(([source]) => wanted.has(source))
    .map(([source, raw]) => [source, opts.maskSeo ? maskSeoTerms(raw) : raw] as [SourceName, string]);

  for (const [source, hay] of layers) {
    if (!hay) continue;
    for (const entry of dict) {
      for (const kw of entry.keywords) {
        if (!hit(hay, kw)) continue;
        const existing = hits.get(entry.id);
        if (existing) {
          existing.sources.add(source);
          existing.hits += 1;
        } else {
          hits.set(entry.id, {
            entry,
            first: { source, evidence: `${source === 'title' ? 'ชื่อ' : source === 'spec' ? 'สเปก' : 'ตัวเลือก'}: ${kw}` },
            sources: new Set([source]),
            hits: 1,
          });
        }
      }
    }
  }

  const tags: EnrichedTag[] = [];
  for (const hitInfo of hits.values()) {
    const base = SOURCE_WEIGHT[hitInfo.first.source];
    const bonus = Math.min(0.16, (hitInfo.sources.size - 1) * 0.08) + Math.min(0.09, (hitInfo.hits - 1) * 0.03);
    tags.push({
      id: hitInfo.entry.id,
      value: hitInfo.entry.label,
      confidence: round(Math.min(0.95, base + bonus), 2),
      evidence: [hitInfo.first.evidence],
    });
  }
  return tags.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

export interface EnrichInput {
  name: string;
  specs: Array<{ name: string; value: string }>;
  options: string[];
  /** หมวดหมู่/ชนิดที่จำแนกจากข้อความแล้ว — ใช้เป็นหลักฐานของกฎ heuristic */
  category?: string;
  product_type?: string;
  width_cm?: number | null;
  depth_cm?: number | null;
}

const EMPTY_SEGMENT: PriceSegment = {
  label: 'Unknown',
  basis: 'unknown',
  percentile: null,
  sample: 0,
  median: null,
};

function sizeTags(width: number | null | undefined, depth: number | null | undefined): EnrichedTag[] {
  if (!width || !depth || width <= 0 || depth <= 0) return [];
  const footprint = width * depth;
  if (footprint > MEDIUM_FOOTPRINT_CM2) return [];
  const strong = footprint <= SMALL_FOOTPRINT_CM2;
  return [
    {
      id: 'small_space',
      value: 'พื้นที่จำกัด',
      confidence: strong ? 0.75 : 0.6,
      evidence: [`ขนาด: ${round(width, 1)}×${round(depth, 1)} ซม.`],
    },
  ];
}

function mergeTags(a: EnrichedTag[], b: EnrichedTag[]): EnrichedTag[] {
  const out = new Map<string, EnrichedTag>();
  for (const tag of [...a, ...b]) {
    const prev = out.get(tag.id);
    if (!prev) {
      out.set(tag.id, { ...tag, evidence: [...tag.evidence] });
      continue;
    }
    out.set(tag.id, {
      ...prev,
      confidence: Math.max(prev.confidence, tag.confidence),
      evidence: [...new Set([...prev.evidence, ...tag.evidence])].slice(0, 3),
    });
  }
  return [...out.values()].sort((x, y) => y.confidence - x.confidence);
}

/** target context = context ที่มีหลักฐาน + เงื่อนไขพื้นที่ (ถ้ามี) */
function targetContexts(contexts: EnrichedTag[], spaces: EnrichedTag[], useCases: EnrichedTag[]): EnrichedTag[] {
  const limited = spaces.some((s) => s.id === 'small_space');
  const out: EnrichedTag[] = [];
  for (const ctx of contexts.slice(0, 2)) {
    out.push({
      id: limited ? `${ctx.id}__small` : ctx.id,
      value: limited ? `${ctx.value} · พื้นที่จำกัด` : ctx.value,
      confidence: round(ctx.confidence * (limited ? 0.95 : 0.9), 2),
      evidence: [
        ...ctx.evidence,
        ...(limited ? spaces.filter((s) => s.id === 'small_space').flatMap((s) => s.evidence).slice(0, 1) : []),
      ].slice(0, 3),
    });
  }
  if (!contexts.length && limited) {
    out.push({
      id: 'small_space_only',
      value: 'พื้นที่จำกัด',
      confidence: 0.6,
      evidence: spaces.find((s) => s.id === 'small_space')?.evidence.slice(0, 1) ?? [],
    });
  }
  // ถ้ามี use case ที่ชัดแต่ไม่มี context — ใช้ use case เป็นบริบทเป้าหมายแทน
  if (!contexts.length && useCases.length) {
    const top = useCases[0];
    out.push({
      id: `use_${top.id}`,
      value: top.value,
      confidence: round(top.confidence * 0.8, 2),
      evidence: top.evidence.slice(0, 1),
    });
  }
  return out.slice(0, 3);
}

/** สกัด enrichment จากข้อความ + ขนาด (price segment เติมทีหลังด้วย attachPriceSegments) */
export function enrichProduct(input: EnrichInput): ProductEnrichment {
  const text = {
    title: String(input.name ?? '').toLowerCase(),
    spec: (input.specs ?? [])
      .map((s) => `${s.name} ${s.value}`)
      .join(' ')
      .toLowerCase(),
    option: (input.options ?? []).join(' ').toLowerCase(),
  };

  // 1) พจนานุกรมคำ (หลักฐานจากคำที่พบจริง)
  const baseUse = collect(text, USES);
  const baseFn = collect(text, FUNCTIONS);
  const baseCtx = collect(text, CONTEXTS);
  // style: อ่านเฉพาะสเปก/ตัวเลือก (title เป็นที่อยู่หลักของ SEO) + mask คำโฆษณา
  const baseStyle = collect(text, STYLES, { sources: ['spec', 'option'], maskSeo: true });
  const baseSpace = mergeTags(collect(text, SPACES), sizeTags(input.width_cm, input.depth_cm));
  const baseAudience = collect(text, AUDIENCES);

  // 2) กฎ heuristic จากหมวด/ชนิดสินค้า — เติมเฉพาะค่าที่ยังไม่มี
  const buckets: Record<HeuristicAttr, EnrichedTag[]> = {
    use_case: baseUse,
    function: baseFn,
    context: baseCtx,
    style: baseStyle,
    space: baseSpace,
  };
  const heur = applyHeuristics({
    text: `${text.title} ${text.spec} ${text.option}`,
    category: String(input.category ?? ''),
    product_type: String(input.product_type ?? ''),
    has: (attr, valueId) => (buckets[attr] ?? []).some((t) => t.id === valueId),
  });
  const heurOf = (attr: HeuristicAttr) => heur.filter((h) => h.attribute === attr).map((h) => h.tag);

  const use_cases = mergeTags(baseUse, heurOf('use_case'));
  const functions = mergeTags(baseFn, heurOf('function'));
  const contexts = mergeTags(baseCtx, heurOf('context'));
  const styles = mergeTags(baseStyle, heurOf('style'));
  const spaces = mergeTags(baseSpace, heurOf('space'));
  const audiences = baseAudience;
  const target_contexts = targetContexts(contexts, spaces, use_cases);

  return {
    use_cases,
    functions,
    contexts,
    styles,
    spaces,
    audiences,
    target_contexts,
    price_segment: { ...EMPTY_SEGMENT },
  };
}

export function emptyEnrichment(): ProductEnrichment {
  return {
    use_cases: [],
    functions: [],
    contexts: [],
    styles: [],
    spaces: [],
    audiences: [],
    target_contexts: [],
    price_segment: { ...EMPTY_SEGMENT },
  };
}

/* ── Price segment เทียบตลาดของหมวด ─────────────────────────── */

/** จำนวนตัวอย่างขั้นต่ำต่อหมวดก่อนใช้ median/quantile ของจริง */
export const PRICE_SEGMENT_MIN_SAMPLE = 8;

function absoluteSegment(price: number): PriceSegment {
  if (!price || price <= 0) return { ...EMPTY_SEGMENT };
  const label: PriceSegment['label'] =
    price < 100 ? 'Budget' : price < 500 ? 'Value' : price < 2000 ? 'Mid' : price < 10000 ? 'Premium' : 'Luxury';
  return { label, basis: 'absolute', percentile: null, sample: 0, median: null };
}

/**
 * เติม price segment ให้ทุก record โดยเทียบกับราคาของสินค้าหมวดเดียวกัน
 * - หมวดมี sample ≥ PRICE_SEGMENT_MIN_SAMPLE → market (quantile p20/p50/p80/p95)
 * - ไม่พอ → absolute + flag price_segment_low_sample
 */
export function attachPriceSegments(products: NormalizedProduct[]): void {
  const byCat = new Map<string, number[]>();
  for (const p of products) {
    if (p.price > 0) {
      const key = p.category && p.category !== 'other' ? p.category : 'other';
      const list = byCat.get(key) ?? [];
      list.push(p.price);
      byCat.set(key, list);
    }
  }

  const stats = new Map<string, { n: number; median: number; p20: number; p50: number; p80: number; p95: number }>();
  for (const [cat, prices] of byCat) {
    if (prices.length < PRICE_SEGMENT_MIN_SAMPLE) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    stats.set(cat, {
      n: prices.length,
      median: median(sorted) ?? 0,
      p20: quantile(sorted, 0.2) ?? 0,
      p50: quantile(sorted, 0.5) ?? 0,
      p80: quantile(sorted, 0.8) ?? 0,
      p95: quantile(sorted, 0.95) ?? 0,
    });
  }

  for (const p of products) {
    if (p.price <= 0) {
      p.enrichment.price_segment = { ...EMPTY_SEGMENT };
      p.quality_flags.push('price_segment_unknown');
      continue;
    }
    const key = p.category && p.category !== 'other' ? p.category : 'other';
    const s = stats.get(key);
    if (!s) {
      p.enrichment.price_segment = absoluteSegment(p.price);
      p.quality_flags.push('price_segment_low_sample');
      continue;
    }
    const label: PriceSegment['label'] =
      p.price <= s.p20 ? 'Budget' : p.price <= s.p50 ? 'Value' : p.price <= s.p80 ? 'Mid' : p.price <= s.p95 ? 'Premium' : 'Luxury';
    p.enrichment.price_segment = {
      label,
      basis: 'market',
      percentile: round(byCat.get(key)!.filter((v) => v <= p.price).length / s.n, 2),
      sample: s.n,
      median: round(s.median, 2),
    };
  }
}

/* ── สรุปภาพรวมสำหรับ UI/audit ──────────────────────────────── */

export interface EnrichmentCoverage {
  total: number;
  use_case: number;
  function: number;
  context: number;
  style: number;
  space: number;
  audience: number;
  target_context: number;
  price_segment_market: number;
  price_segment_absolute: number;
  price_segment_unknown: number;
  avg_tags: number;
}

export function enrichmentCoverage(products: NormalizedProduct[]): EnrichmentCoverage {
  const total = products.length;
  const has = (f: (p: NormalizedProduct) => boolean) => products.filter(f).length;
  const tagsTotal = products.reduce(
    (n, p) =>
      n + p.enrichment.use_cases.length + p.enrichment.functions.length + p.enrichment.contexts.length + p.enrichment.styles.length + p.enrichment.spaces.length + (p.enrichment.audiences?.length ?? 0),
    0,
  );
  return {
    total,
    use_case: has((p) => p.enrichment.use_cases.length > 0),
    function: has((p) => p.enrichment.functions.length > 0),
    context: has((p) => p.enrichment.contexts.length > 0),
    style: has((p) => p.enrichment.styles.length > 0),
    space: has((p) => p.enrichment.spaces.length > 0),
    audience: has((p) => (p.enrichment.audiences?.length ?? 0) > 0),
    target_context: has((p) => p.enrichment.target_contexts.length > 0),
    price_segment_market: has((p) => p.enrichment.price_segment.basis === 'market'),
    price_segment_absolute: has((p) => p.enrichment.price_segment.basis === 'absolute'),
    price_segment_unknown: has((p) => p.enrichment.price_segment.basis === 'unknown'),
    avg_tags: total ? round(tagsTotal / total, 2) : 0,
  };
}

export const PRICE_SEGMENT_LABEL: Record<PriceSegment['label'], string> = {
  Budget: 'ประหยัด',
  Value: 'คุ้มค่า',
  Mid: 'กลาง',
  Premium: 'พรีเมียม',
  Luxury: 'หรูหรา',
  Unknown: 'ไม่ทราบ',
};
