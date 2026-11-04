/**
 * Product → product projection
 * ----------------------------
 * สร้าง edge เชิงความหมายจาก bipartite product→attribute ที่ pipeline สร้างไว้แล้ว
 * แล้ว prune ด้วยหลักฐานจริง (attribute overlap + shared context/category)
 *
 * ชนิด edge ที่นี่รับผิดชอบ:
 *  - similar_to / substitute : สินค้าประเภทเดียวกัน คล้ายกันจริง (overlap ≥ เกณฑ์)
 *  - complements             : คนละประเภท แต่ใช้ use case ร่วมกัน
 *  - same_context            : คนละประเภท อยู่บริบทเดียวกัน (และไม่มี use case ร่วม)
 *  - used_with               : มีหลักฐานวลี "ใช้ด้วยกัน" ในข้อความจริง
 *
 * ทุกเส้นต้องมี evidence ติดไปเสมอ (ตรวจในเทสต์)
 */
import type { EdgeType, NormalizedProduct } from './types';
import {
  BUNDLE_PATTERNS,
  GRAPH_RULES,
  bundleEvidenceText,
  contextualKeys,
  intersect,
  meanConfidence,
  overlap,
  roundWeight,
  semanticKeySet,
  semanticTags,
  trustFactor,
  type SemanticTag,
} from './graph-rules';
import { jaccard, shingles } from './text';

export interface ProjectionConfig {
  similarity_threshold: number;
  max_neighbors: number;
  max_pair_candidates: number;
  edge_min_confidence: number;
  attribute_overlap_min: number;
}

export const DEFAULT_PROJECTION_CONFIG: ProjectionConfig = {
  similarity_threshold: 0.34,
  max_neighbors: 8,
  max_pair_candidates: 250,
  edge_min_confidence: GRAPH_RULES.edge_min_confidence,
  attribute_overlap_min: GRAPH_RULES.attribute_overlap_min,
};

/** เพดานเพื่อนบ้านของ edge เชิงบริบท (กัน similarity กลบ complementarity) */
export const PROJECTION_MAX_NEIGHBORS = 4;

export interface PairEdgeDraft {
  type: EdgeType;
  source: string;
  target: string;
  weight: number;
  evidence: Record<string, any>;
  directed: boolean;
}

interface ProductIndex {
  tags: SemanticTag[];
  semantic: Set<string>;
  contextual: Set<string>;
  byKey: Map<string, SemanticTag>;
}

function indexProduct(p: NormalizedProduct, minConfidence: number): ProductIndex {
  const tags = semanticTags(p, minConfidence);
  return {
    tags,
    semantic: semanticKeySet(tags),
    contextual: contextualKeys(tags),
    byKey: new Map(tags.map((t) => [t.key, t])),
  };
}

function labels(idx: ProductIndex, keys: string[]): string[] {
  return keys.map((k) => idx.byKey.get(k)?.label ?? k.split(':').slice(1).join(':'));
}

function priceCompat(a: NormalizedProduct, b: NormalizedProduct): number {
  if (!(a.price > 0) || !(b.price > 0)) return 0;
  return Math.min(a.price, b.price) / Math.max(a.price, b.price);
}

/* ── similarity candidates (inverted index จาก shingle) ─────── */

interface SimilarityPair {
  a: NormalizedProduct;
  b: NormalizedProduct;
  similarity: number;
  priceCompat: number;
  sharedShingles: number;
}

function similarityCandidates(products: NormalizedProduct[], maxCandidates: number): SimilarityPair[] {
  const byId = new Map<string, NormalizedProduct>();
  const shingleMap = new Map<string, string[]>();
  const productShingles = new Map<string, Set<string>>();

  for (const p of products) {
    byId.set(p.node_key, p);
    const text = `${p.name} ${p.specs.map((s) => `${s.name} ${s.value}`).join(' ')}`;
    const set = shingles(text, 3);
    productShingles.set(p.node_key, set);
    for (const s of set) {
      const list = shingleMap.get(s);
      if (list) list.push(p.node_key);
      else shingleMap.set(s, [p.node_key]);
    }
  }

  const pairs: SimilarityPair[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (p.product_type === 'other') continue;
    const own = productShingles.get(p.node_key);
    if (!own) continue;
    const counts = new Map<string, number>();
    for (const s of own) {
      const list = shingleMap.get(s);
      if (!list || list.length > 400) continue;
      for (const other of list) {
        if (other === p.node_key) continue;
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
    }
    const candidates = [...counts.entries()]
      .filter(([, c]) => c >= Math.min(3, own.size))
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCandidates);

    for (const [otherId, sharedCount] of candidates) {
      const q = byId.get(otherId);
      if (!q) continue;
      if (q.product_type !== p.product_type) continue;
      const key = p.node_key < q.node_key ? `${p.node_key}||${q.node_key}` : `${q.node_key}||${p.node_key}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const sim = jaccard(own, productShingles.get(q.node_key) ?? new Set());
      if (sim <= 0) continue;
      pairs.push({
        a: p,
        b: q,
        similarity: sim,
        priceCompat: priceCompat(p, q),
        sharedShingles: sharedCount,
      });
    }
  }
  return pairs;
}

/* ── context projection (bipartite → unipartite) ─────────────── */

interface ContextPair {
  a: NormalizedProduct;
  b: NormalizedProduct;
  sharedUse: string[];
  sharedCtx: string[];
}

function contextCandidates(products: NormalizedProduct[], minConfidence: number): ContextPair[] {
  const index = new Map<string, ProductIndex>();
  for (const p of products) index.set(p.node_key, indexProduct(p, minConfidence));

  // key (use:/ctx:) → product keys ที่มี tag นั้น
  const buckets = new Map<string, string[]>();
  for (const p of products) {
    const idx = index.get(p.node_key)!;
    for (const key of idx.contextual) {
      const list = buckets.get(key);
      if (list) list.push(p.node_key);
      else buckets.set(key, [p.node_key]);
    }
  }

  const byId = new Map(products.map((p) => [p.node_key, p]));
  const acc = new Map<string, ContextPair>();
  for (const [key, keys] of buckets) {
    if (keys.length < 2 || keys.length > 400) continue;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = byId.get(keys[i])!;
        const b = byId.get(keys[j])!;
        if (!a || !b) continue;
        if (a.product_type === b.product_type) continue; // ประเภทเดียวกัน → similarity/substitute
        if (!a.product_type || !b.product_type || a.product_type === 'other' || b.product_type === 'other') continue;
        const pairKey = a.node_key < b.node_key ? `${a.node_key}||${b.node_key}` : `${b.node_key}||${a.node_key}`;
        const prev = acc.get(pairKey) ?? { a, b, sharedUse: [], sharedCtx: [] };
        if (key.startsWith('use:')) {
          if (!prev.sharedUse.includes(key)) prev.sharedUse.push(key);
        } else if (!prev.sharedCtx.includes(key)) {
          prev.sharedCtx.push(key);
        }
        acc.set(pairKey, prev);
      }
    }
  }
  return [...acc.values()];
}

/* ── main ───────────────────────────────────────────────────── */

export function buildPairEdges(
  products: NormalizedProduct[],
  config: Partial<ProjectionConfig> = {},
): PairEdgeDraft[] {
  const cfg = { ...DEFAULT_PROJECTION_CONFIG, ...config };
  const indexes = new Map<string, ProductIndex>();
  for (const p of products) indexes.set(p.node_key, indexProduct(p, cfg.edge_min_confidence));

  const drafts: PairEdgeDraft[] = [];
  const seen = new Set<string>();
  const addDraft = (draft: PairEdgeDraft) => {
    const key = `${draft.type}|${[draft.source, draft.target].sort().join('||')}`;
    if (seen.has(key)) return;
    seen.add(key);
    drafts.push({ ...draft, weight: roundWeight(draft.weight) });
  };

  // 1) complements / same_context / used_with
  const projectionCap = new Map<string, number>();
  const projectionDrafts: PairEdgeDraft[] = [];
  for (const pair of contextCandidates(products, cfg.edge_min_confidence)) {
    const { a, b } = pair;
    const ia = indexes.get(a.node_key)!;
    const ib = indexes.get(b.node_key)!;
    const compat = priceCompat(a, b);
    if (compat < 0.05) continue; // ราคาต่างกันเกิน 20 เท่า — ไม่ใช่คู่เสริมกัน
    const trust = trustFactor(a, b);

    const sharedContexts = labels(ia, pair.sharedCtx).filter((v, i, arr) => arr.indexOf(v) === i);
    const sharedUseCases = labels(ia, pair.sharedUse).filter((v, i, arr) => arr.indexOf(v) === i);
    const conf = meanConfidence(ia.tags, [...pair.sharedUse, ...pair.sharedCtx]);
    if (conf <= 0) continue;

    const hasUse = pair.sharedUse.length > 0;
    const type: EdgeType = hasUse ? 'complements' : 'same_context';
    const baseWeight = hasUse
      ? conf * 0.6 * (0.8 + 0.2 * compat) * trust
      : conf * 0.5 * trust;

    // หลักฐานวลี "ใช้ด้วยกัน" — ต้องพบในข้อความจริงเท่านั้น
    const bundleA = BUNDLE_PATTERNS.exec(bundleEvidenceText(a));
    const bundleB = BUNDLE_PATTERNS.exec(bundleEvidenceText(b));
    const bundle = bundleA ?? bundleB;

    if (bundle) {
      const quote = bundle[0];
      projectionDrafts.push({
        type: 'used_with',
        source: a.node_key,
        target: b.node_key,
        weight: Math.min(1, 0.5 + 0.3 * conf + 0.2 * trust),
        evidence: {
          basis: 'bundle_phrase',
          quote,
          shared_contexts: sharedContexts,
          shared_use_cases: sharedUseCases,
          confidence: Math.round(conf * 1000) / 1000,
        },
        directed: false,
      });
    }

    projectionDrafts.push({
      type,
      source: a.node_key,
      target: b.node_key,
      weight: baseWeight,
      evidence: {
        basis: hasUse ? 'shared_use_case' : 'shared_context',
        shared_contexts: sharedContexts,
        shared_use_cases: sharedUseCases,
        price_compat: Math.round(compat * 1000) / 1000,
        confidence: Math.round(conf * 1000) / 1000,
        tier: conf >= GRAPH_RULES.edge_strong_min_confidence ? 'strong' : 'standard',
      },
      directed: false,
    });
  }

  projectionDrafts.sort(
    (x, y) => y.weight - x.weight || x.type.localeCompare(y.type) || x.source.localeCompare(y.source),
  );
  for (const draft of projectionDrafts) {
    if ((projectionCap.get(draft.source) ?? 0) >= PROJECTION_MAX_NEIGHBORS) continue;
    if ((projectionCap.get(draft.target) ?? 0) >= PROJECTION_MAX_NEIGHBORS) continue;
    projectionCap.set(draft.source, (projectionCap.get(draft.source) ?? 0) + 1);
    projectionCap.set(draft.target, (projectionCap.get(draft.target) ?? 0) + 1);
    addDraft(draft);
  }

  // 2) similar_to / substitute — ต้องผ่าน attribute overlap + shared context/category
  for (const pair of similarityCandidates(products, cfg.max_pair_candidates)) {
    const ia = indexes.get(pair.a.node_key)!;
    const ib = indexes.get(pair.b.node_key)!;
    const attrOverlap = overlap(ia.semantic, ib.semantic);
    if (attrOverlap < cfg.attribute_overlap_min) continue;

    const shared = intersect(ia.contextual, ib.contextual);
    const evidenceGap = shared.length === 0;
    const trust = trustFactor(pair.a, pair.b);
    let weight =
      (0.45 * attrOverlap + 0.3 * pair.similarity + 0.25 * pair.priceCompat) * trust;
    if (evidenceGap) weight *= GRAPH_RULES.evidence_gap_penalty;
    if (weight < cfg.similarity_threshold) continue;

    const sameShop = Boolean(pair.a.shop_id) && pair.a.shop_id === pair.b.shop_id;
    const type: EdgeType =
      pair.priceCompat >= GRAPH_RULES.substitute_price_compat && !sameShop ? 'substitute' : 'similar_to';
    addDraft({
      type,
      source: pair.a.node_key,
      target: pair.b.node_key,
      weight,
      evidence: {
        basis: evidenceGap ? 'shared_category' : 'shared_context',
        evidence_gap: evidenceGap,
        shared_contexts: labels(ia, shared),
        attribute_overlap: Math.round(attrOverlap * 1000) / 1000,
        shingle_similarity: Math.round(pair.similarity * 1000) / 1000,
        price_compat: Math.round(pair.priceCompat * 1000) / 1000,
        same_shop: sameShop,
        same_brand: Boolean(pair.a.brand) && pair.a.brand === pair.b.brand,
      },
      directed: false,
    });
  }

  // เรียงใหม่ทั้งชุดตาม weight แล้วบังคับเพดานเพื่อนบ้านรวม (projection ถูกนับไปแล้ว)
  const ordered = [...drafts].sort(
    (x, y) => y.weight - x.weight || x.type.localeCompare(y.type) || x.source.localeCompare(y.source),
  );
  const capped: PairEdgeDraft[] = [];
  const totalCap = new Map<string, number>();
  for (const draft of ordered) {
    const isProjection = draft.type !== 'similar_to' && draft.type !== 'substitute';
    if (isProjection) {
      capped.push(draft);
      totalCap.set(draft.source, (totalCap.get(draft.source) ?? 0) + 1);
      totalCap.set(draft.target, (totalCap.get(draft.target) ?? 0) + 1);
    }
  }
  for (const draft of ordered) {
    if (draft.type === 'similar_to' || draft.type === 'substitute') {
      if ((totalCap.get(draft.source) ?? 0) >= cfg.max_neighbors) continue;
      if ((totalCap.get(draft.target) ?? 0) >= cfg.max_neighbors) continue;
      totalCap.set(draft.source, (totalCap.get(draft.source) ?? 0) + 1);
      totalCap.set(draft.target, (totalCap.get(draft.target) ?? 0) + 1);
      capped.push(draft);
    }
  }
  return capped;
}
