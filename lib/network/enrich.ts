/**
 * Product Understanding & Enrichment — Rule-based
 * -----------------------------------------------------
 * CHANGELOG v2 (2026-11-05):
 *  - ✅ เรียกใช้ applyHeuristics() แล้ว (เดิม import แต่ไม่เคยเรียก!)
 *  - ✅ สร้าง audiences[] จาก rule
 *  - ✅ เพิ่ม SEO_BLOCKLIST (ญี่ปุ่น→style)
 *  - ✅ ลบ targetContext 'small_space_only' ที่ซ้ำกับ space.small_space
 */

import type { EnrichedTag, NormalizedProduct, PriceSegment, ProductEnrichment } from './types';
import { median, quantile, round } from './text';
import { keywordValues, valueLabel, type AttrId } from './vocab';
import { applyHeuristics, type HeuristicAttr } from './heuristics';

interface DictEntry {
  id: string;
  label: string;
  keywords: string[];
}

const dictOf = (attr: AttrId): DictEntry[] =>
  keywordValues(attr).map(({ id, label, keywords }) => ({ id, label, keywords }));

export const USES: DictEntry[] = dictOf('use_case');
export const FUNCTIONS: DictEntry[] = dictOf('function');
export const CONTEXTS: DictEntry[] = dictOf('context');
export const STYLES: DictEntry[] = dictOf('style');
export const SPACES: DictEntry[] = dictOf('space');
export const AUDIENCES: DictEntry[] = dictOf('audience');

const SMALL_FOOTPRINT_CM2 = 1600;
const MEDIUM_FOOTPRINT_CM2 = 2500;

const SOURCE_WEIGHT = { title: 0.6, spec: 0.5, option: 0.4 } as const;
type SourceName = keyof typeof SOURCE_WEIGHT;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiWord(kw: string): boolean {
  return /^[a-z0-9][a-z0-9 _-]*$/i.test(kw);
}

const BLOCKED_SUFFIX: Record<string, string[]> = {
  แต่งหน้า: ['บ้าน', 'ต่าง', 'ประตู', 'ร้าน', 'เวที', 'สวน'],
  เด็ก: ['เล่น', 'แถว', 'น้อย'],
  ญี่ปุ่น: ['ฟิวชั่น', 'ดั้งเดิม', 'แท้'],
};

const SEO_BLOCKLIST: Record<string, AttrId[]> = {
  ญี่ปุ่น: ['style'],
};

function thaiHit(haystack: string, keyword: string): boolean {
  const blocked = BLOCKED_SUFFIX[keyword];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(keyword, from);
    if (idx < 0) return false;
    if (!blocked) return true;
    const after = haystack.slice(idx + keyword.length, idx + keyword.length + 8);
    if (!blocked.some((b) => after.startsWith(b))) return true;
    from = idx + keyword.length;
  }
}

function hit(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (isAsciiWord(kw)) {
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(kw)}(?:$|[^a-z0-9])`).test(haystack);
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
  attr: AttrId,
): EnrichedTag[] {
  const hits = new Map<string, TagHit>();
  const layers: Array<[SourceName, string]> = [
    ['title', text.title],
    ['spec', text.spec],
    ['option', text.option],
  ];

  for (const [source, hay] of layers) {
    if (!hay) continue;
    for (const entry of dict) {
      for (const kw of entry.keywords) {
        const blockedAttrs = SEO_BLOCKLIST[kw];
        if (blockedAttrs && blockedAttrs.includes(attr)) continue;
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

function groupHeuristicTags(
  tags: Array<{ attribute: HeuristicAttr; tag: EnrichedTag }>,
): Record<HeuristicAttr, EnrichedTag[]> {
  const out: Record<HeuristicAttr, EnrichedTag[]> = {
    use_case: [],
    function: [],
    context: [],
    style: [],
    space: [],
  };
  for (const t of tags) {
    if (out[t.attribute]) out[t.attribute].push(t.tag);
  }
  return out;
}

export function enrichProduct(input: EnrichInput): ProductEnrichment {
  const text = {
    title: String(input.name ?? '').toLowerCase(),
    spec: (input.specs ?? [])
      .map((s) => `${s.name} ${s.value}`)
      .join(' ')
      .toLowerCase(),
    option: (input.options ?? []).join(' ').toLowerCase(),
  };

  // 1) Dictionary
  const use_cases = collect(text, USES, 'use_case');
  const functions = collect(text, FUNCTIONS, 'function');
  const contexts = collect(text, CONTEXTS, 'context');
  const styles = collect(text, STYLES, 'style');
  const spaces = mergeTags(collect(text, SPACES, 'space'), sizeTags(input.width_cm, input.depth_cm));
  const audiences = collect(text, AUDIENCES, 'audience');

  // 2) Heuristics (เติมเฉพาะที่ไม่มี)
  const combinedText = [text.title, text.spec, text.option].join(' ');
  const has = (attr: HeuristicAttr, valueId: string): boolean => {
    const map: Record<HeuristicAttr, EnrichedTag[]> = {
      use_case: use_cases,
      function: functions,
      context: contexts,
      style: styles,
      space: spaces,
    };
    return (map[attr] ?? []).some((t) => t.id === valueId);
  };
  const heuristicTags = applyHeuristics({
    text: combinedText,
    category: String(input.category ?? ''),
    product_type: String(input.product_type ?? ''),
    has,
  });
  const grouped = groupHeuristicTags(heuristicTags);

  // 3) Merge (dictionary ชนะ heuristic เพราะ confidence สูงกว่า)
  const finalUseCases = mergeTags(use_cases, grouped.use_case);
  const finalFunctions = mergeTags(functions, grouped.function);
  const finalContexts = mergeTags(contexts, grouped.context);
  const finalStyles = mergeTags(styles, grouped.style);
  const finalSpaces = mergeTags(spaces, grouped.space);

  return {
    use_cases: finalUseCases,
    functions: finalFunctions,
    contexts: finalContexts,
    styles: finalStyles,
    spaces: finalSpaces,
    audiences,
    target_contexts: targetContexts(finalContexts, finalSpaces, finalUseCases),
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

export const PRICE_SEGMENT_MIN_SAMPLE = 8;

function absoluteSegment(price: number): PriceSegment {
  if (!price || price <= 0) return { ...EMPTY_SEGMENT };
  const label: PriceSegment['label'] =
    price < 100 ? 'Budget' : price < 500 ? 'Value' : price < 2000 ? 'Mid' : price < 10000 ? 'Premium' : 'Luxury';
  return { label, basis: 'absolute', percentile: null, sample: 0, median: null };
}

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
      n +
      p.enrichment.use_cases.length +
      p.enrichment.functions.length +
      p.enrichment.contexts.length +
      p.enrichment.styles.length +
      p.enrichment.spaces.length +
      p.enrichment.audiences.length,
    0,
  );
  return {
    total,
    use_case: has((p) => p.enrichment.use_cases.length > 0),
    function: has((p) => p.enrichment.functions.length > 0),
    context: has((p) => p.enrichment.contexts.length > 0),
    style: has((p) => p.enrichment.styles.length > 0),
    space: has((p) => p.enrichment.spaces.length > 0),
    audience: has((p) => p.enrichment.audiences.length > 0),
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