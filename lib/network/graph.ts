/**
 * Graph builder (v2): nodes/edges ของสินค้า + enrichment (หลักฐาน)
 * + ai_attribute/ai_about (AI อนุมาน) แยกชนิดกันโดยเด็ดขาด
 */
import type {
  EdgeType,
  Graph,
  GraphEdge,
  GraphNode,
  Hub,
  NetworkStats,
  NormalizedProduct,
  NodeType,
  PipelineConfig,
} from './types';
import { jaccard, round, shingles, slugKey } from './text';
import { categoryLabel, typeLabel } from './taxonomy';
import { PRICE_SEGMENT_LABEL } from './enrich';

const DEFAULT_CONFIG: Pick<
  PipelineConfig,
  | 'similarity_threshold'
  | 'max_neighbors'
  | 'max_pair_candidates'
  | 'variant_nodes'
  | 'enrich_nodes'
  | 'enrich_min_confidence'
  | 'ai_nodes'
> = {
  similarity_threshold: 0.34,
  max_neighbors: 8,
  max_pair_candidates: 250,
  variant_nodes: false,
  enrich_nodes: true,
  enrich_min_confidence: 0.5,
  ai_nodes: false,
};

function productWeight(p: NormalizedProduct): number {
  return round(
    Math.log10(1 + Math.max(0, p.monthly_sold)) * 2 +
      Math.log10(1 + Math.max(0, p.review_count)) +
      Math.log10(1 + Math.max(0, p.price)) * 0.5,
    4,
  );
}

function categoryNodeId(category: string): string {
  return `category:${category}`;
}
function typeNodeId(type: string): string {
  return `type:${type}`;
}
function shopNodeId(p: NormalizedProduct): string {
  return `shop:${p.platform}:${p.shop_id || 'unknown'}`;
}
function brandNodeId(brand: string): string {
  return slugKey('brand', brand);
}
function provinceNodeId(province: string): string {
  return slugKey('province', province);
}
function regionNodeId(region: string): string {
  return slugKey('region', region);
}

function edgeId(type: EdgeType, source: string, target: string): string {
  return `${type}|${source}|${target}`;
}

function makeNode(
  id: string,
  type: NodeType,
  label: string,
  weight: number,
  attributes: Record<string, any> = {},
): GraphNode {
  return { id, type, label, weight, attributes };
}

function makeEdge(
  type: EdgeType,
  source: string,
  target: string,
  weight: number,
  evidence: Record<string, any> = {},
  directed = true,
): GraphEdge {
  return {
    id: edgeId(type, source, target),
    source,
    target,
    type,
    weight: round(weight, 3),
    directed,
    evidence,
  };
}

interface ProductPair {
  a: NormalizedProduct;
  b: NormalizedProduct;
  similarity: number;
  shared: string[];
  priceCompat: number;
}

/** สร้าง candidate pairs ด้วย inverted index ของ shingles (ไม่ทำ O(n²) ทั้งก้อน) */
function candidatePairs(products: NormalizedProduct[], maxCandidates: number): ProductPair[] {
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

  const pairs: ProductPair[] = [];
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
      const priceCompat =
        p.price > 0 && q.price > 0
          ? Math.min(p.price, q.price) / Math.max(p.price, q.price)
          : 0;
      if (sim <= 0) continue;
      pairs.push({
        a: p,
        b: q,
        similarity: sim,
        shared: [`${sharedCount} shared shingles`],
        priceCompat,
      });
    }
  }
  return pairs;
}

function pairScore(pair: ProductPair): number {
  const { a, b, similarity, priceCompat } = pair;
  let score = similarity * 0.6 + priceCompat * 0.25;
  if (a.brand && b.brand && a.brand === b.brand) score += 0.1;
  else if (a.brand && b.brand) score += 0.02;
  if (a.shop_id && a.shop_id === b.shop_id) score += 0.05;
  return Math.min(1, score);
}

function unionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { find, union };
}

export interface GraphExtras {
  /** คู่ listing ที่เป็นสินค้ารุ่นเดียวกัน (สร้างโดย canonical.ts) */
  canonical_pairs?: Array<{
    source: string;
    target: string;
    weight: number;
    evidence: Record<string, any>;
  }>;
}

export function buildGraph(
  products: NormalizedProduct[],
  config: Partial<
    Pick<
      PipelineConfig,
      | 'similarity_threshold'
      | 'max_neighbors'
      | 'max_pair_candidates'
      | 'variant_nodes'
      | 'enrich_nodes'
      | 'enrich_min_confidence'
      | 'ai_nodes'
    >
  > = {},
  extras: GraphExtras = {},
): Graph {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSeen = new Set<string>();

  const addEdge = (e: GraphEdge) => {
    const key = `${e.type}|${[e.source, e.target].sort().join('||')}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push(e);
  };

  // ── product nodes + attribute edges ─────────────────────────
  const shopAgg = new Map<string, {
    label: string;
    count: number;
    categories: Set<string>;
    priceSum: number;
    ratingSum: number;
    ratingN: number;
    verified: boolean;
    province: string;
  }>();
  const brandAgg = new Map<string, { label: string; count: number; monthly: number }>();
  const categoryAgg = new Map<string, number>();
  const typeAgg = new Map<string, number>();
  const provinceAgg = new Map<string, number>();
  const regionAgg = new Map<string, number>();
  const enrichAgg = new Map<
    string,
    { type: NodeType; label: string; count: number; attrs?: Record<string, any> }
  >();

  for (const p of products) {
    nodes.push(
      makeNode(p.node_key, 'product', p.name.slice(0, 90), productWeight(p), {
        product_id: p.product_id,
        shop_id: p.shop_id,
        shop_name: p.shop_name,
        category: p.category,
        product_type: p.product_type,
        brand: p.brand,
        province: p.province,
        region: p.region,
        price: p.price,
        monthly_sold: p.monthly_sold,
        historical_sold: p.historical_sold,
        rating: p.rating,
        review_count: p.review_count,
        quality_score: p.quality_score,
        in_stock: p.in_stock,
        url: p.url,
        image: p.image,
        flags: p.quality_flags,
        use_cases: p.enrichment.use_cases.map((t) => t.value),
        functions: p.enrichment.functions.map((t) => t.value),
        contexts: p.enrichment.contexts.map((t) => t.value),
        styles: p.enrichment.styles.map((t) => t.value),
        spaces: p.enrichment.spaces.map((t) => t.value),
        audiences: (p.enrichment.audiences ?? []).map((t) => t.value),
        target_contexts: p.enrichment.target_contexts.map((t) => t.value),
        price_segment: p.enrichment.price_segment.label,
        ai_tags: p.ai?.tags.length ?? 0,
      }),
    );

    const shopId = shopNodeId(p);
    const prev = shopAgg.get(shopId);
    if (prev) {
      prev.count += 1;
      prev.categories.add(p.category);
      prev.priceSum += p.price;
      if (p.rating != null) {
        prev.ratingSum += p.rating;
        prev.ratingN += 1;
      }
      prev.verified = prev.verified || p.shopee_verified;
    } else {
      shopAgg.set(shopId, {
        label: p.shop_name || p.shop_id || 'unknown shop',
        count: 1,
        categories: new Set([p.category]),
        priceSum: p.price,
        ratingSum: p.rating ?? 0,
        ratingN: p.rating != null ? 1 : 0,
        verified: p.shopee_verified,
        province: p.province,
      });
    }
    addEdge(makeEdge('sold_by', p.node_key, shopId, 1));

    if (p.category && p.category !== 'other') {
      categoryAgg.set(p.category, (categoryAgg.get(p.category) ?? 0) + 1);
      addEdge(makeEdge('in_category', p.node_key, categoryNodeId(p.category), 1));
    }
    if (p.product_type && p.product_type !== 'other') {
      typeAgg.set(p.product_type, (typeAgg.get(p.product_type) ?? 0) + 1);
      addEdge(makeEdge('has_type', p.node_key, typeNodeId(p.product_type), Math.max(0.5, p.type_confidence)));
    }
    if (p.brand) {
      const bId = brandNodeId(p.brand);
      const b = brandAgg.get(bId);
      if (b) {
        b.count += 1;
        b.monthly += p.monthly_sold;
      } else {
        brandAgg.set(bId, { label: p.brand, count: 1, monthly: p.monthly_sold });
      }
      addEdge(makeEdge('brand_of', p.node_key, bId, Math.max(0.4, p.brand_confidence)));
    }
    if (p.province && p.province !== 'ไม่ระบุ') {
      provinceAgg.set(p.province, (provinceAgg.get(p.province) ?? 0) + 1);
      addEdge(makeEdge('located_in', p.node_key, provinceNodeId(p.province), 1));
      if (p.region && p.region !== 'ไม่ระบุ') {
        regionAgg.set(p.region, (regionAgg.get(p.region) ?? 0) + 1);
      }
    }

    // ── Product Understanding & Enrichment → nodes/edges ─────
    if (cfg.enrich_nodes) {
      const groups: Array<[NodeType, EdgeType, typeof p.enrichment.use_cases, string]> = [
        ['use_case', 'used_for', p.enrichment.use_cases, 'use'],
        ['function', 'has_function', p.enrichment.functions, 'fn'],
        ['context', 'fits_context', p.enrichment.contexts, 'ctx'],
        ['style', 'has_style', p.enrichment.styles, 'style'],
        ['space', 'fits_space', p.enrichment.spaces, 'space'],
      ];
      for (const [nodeType, edgeType, tags, prefix] of groups) {
        for (const tag of tags) {
          if (tag.confidence < cfg.enrich_min_confidence) continue;
          const id = `${prefix}:${tag.id}`;
          const prev = enrichAgg.get(id);
          if (prev) prev.count += 1;
          else enrichAgg.set(id, { type: nodeType, label: tag.value, count: 1 });
          addEdge(
            makeEdge(edgeType, p.node_key, id, tag.confidence, {
              confidence: tag.confidence,
              evidence: tag.evidence.slice(0, 2),
            }),
          );
        }
      }

      const seg = p.enrichment.price_segment;
      if (seg.label !== 'Unknown') {
        const id = `segment:${seg.label}`;
        const prev = enrichAgg.get(id);
        if (prev) prev.count += 1;
        else enrichAgg.set(id, { type: 'price_segment', label: PRICE_SEGMENT_LABEL[seg.label], count: 1 });
        addEdge(
          makeEdge('in_price_segment', p.node_key, id, 1, {
            basis: seg.basis,
            percentile: seg.percentile,
            sample: seg.sample,
            median: seg.median,
          }),
        );
      }
    }

    // ── ค่าที่ AI อนุมาน (แยกชนิดโหนด/edge จากหลักฐานเสมอ) ────
    if (cfg.ai_nodes && p.ai?.tags?.length) {
      for (const tag of p.ai.tags) {
        const id = `ai:${tag.attribute}:${tag.value_id}`;
        const prev = enrichAgg.get(id);
        if (prev) prev.count += 1;
        else
          enrichAgg.set(id, {
            type: 'ai_attribute',
            label: tag.value,
            count: 1,
            attrs: {
              attribute: tag.attribute,
              value_id: tag.value_id,
              evidence_level: 'ai_inferred',
            },
          });
        addEdge(
          makeEdge('ai_about', p.node_key, id, tag.confidence, {
            attribute: tag.attribute,
            value_id: tag.value_id,
            confidence: tag.confidence,
            grounded: tag.grounded,
            conflict: tag.conflict ?? false,
            quote: tag.quote ?? null,
          }),
        );
      }
    }

    // ตัวเลือก/SKU — เปิดเฉพาะเมื่อขอ (ค่าเริ่มต้นปิดเพื่อไม่ให้ภาพรก)
    if (cfg.variant_nodes && p.variants.length) {
      p.variants.slice(0, 60).forEach((v, idx) => {
        const vId = `variant:${p.ext}:${v.model_id || idx}`;
        nodes.push(
          makeNode(vId, 'variant', v.name || v.model_id || `ตัวเลือก ${idx + 1}`, 1, {
            product_key: p.node_key,
            model_id: v.model_id,
            price: v.price,
            stock: v.stock,
            available: v.available,
            color: v.color,
            size_label: v.size_label,
          }),
        );
        addEdge(
          makeEdge('variant_of', vId, p.node_key, 1, {
            variant: v.name,
            price: v.price,
            available: v.available,
          }),
        );
      });
    }
  }

  // ── shop / brand / category / type / province nodes ─────────
  for (const [id, agg] of shopAgg) {
    nodes.push(
      makeNode(id, 'shop', agg.label, agg.count, {
        product_count: agg.count,
        categories: [...agg.categories],
        avg_price: round(agg.priceSum / agg.count, 2),
        avg_rating: agg.ratingN ? round(agg.ratingSum / agg.ratingN, 2) : null,
        verified: agg.verified,
        province: agg.province,
      }),
    );
    if (agg.province && agg.province !== 'ไม่ระบุ') {
      addEdge(makeEdge('shop_located_in', id, provinceNodeId(agg.province), 1, { products: agg.count }));
    }
  }

  for (const [id, agg] of brandAgg) {
    nodes.push(
      makeNode(id, 'brand', agg.label, agg.count, {
        product_count: agg.count,
        monthly_sold: agg.monthly,
      }),
    );
  }

  for (const [id, count] of categoryAgg) {
    nodes.push(makeNode(categoryNodeId(id), 'category', categoryLabel(id), count, { product_count: count }));
  }
  for (const [id, count] of typeAgg) {
    nodes.push(makeNode(typeNodeId(id), 'product_type', typeLabel(id), count, { product_count: count }));
  }
  for (const [province, count] of provinceAgg) {
    nodes.push(makeNode(provinceNodeId(province), 'province', province, count, { product_count: count }));
  }
  for (const [region, count] of regionAgg) {
    nodes.push(makeNode(regionNodeId(region), 'region', region, count, { product_count: count }));
  }
  for (const [id, agg] of enrichAgg) {
    nodes.push(
      makeNode(id, agg.type, agg.label, agg.count, { product_count: agg.count, ...(agg.attrs ?? {}) }),
    );
  }

  // type → category
  for (const p of products) {
    if (p.product_type === 'other' || p.category === 'other') continue;
    addEdge(
      makeEdge(
        'subtype_of',
        typeNodeId(p.product_type),
        categoryNodeId(p.category),
        1,
        { type: p.product_type, category: p.category },
      ),
    );
  }
  // province → region
  for (const p of products) {
    if (p.province === 'ไม่ระบุ' || p.region === 'ไม่ระบุ') continue;
    addEdge(
      makeEdge('part_of_region', provinceNodeId(p.province), regionNodeId(p.region), 1, {
        province: p.province,
        region: p.region,
      }),
    );
  }

  // ── product ↔ product edges ────────────────────────────────
  const pairs = candidatePairs(products, cfg.max_pair_candidates)
    .map((pair) => ({ pair, score: pairScore(pair) }))
    .filter((x) => x.score >= cfg.similarity_threshold)
    .sort((a, b) => b.score - a.score);

  const neighborCount = new Map<string, number>();
  const canAdd = (p: NormalizedProduct) => (neighborCount.get(p.node_key) ?? 0) < cfg.max_neighbors;

  for (const { pair, score } of pairs) {
    if (!canAdd(pair.a) || !canAdd(pair.b)) continue;
    const sameShop = pair.a.shop_id && pair.a.shop_id === pair.b.shop_id;
    const substitute =
      pair.priceCompat >= 0.8 && !sameShop && pair.a.product_type === pair.b.product_type;
    const type: EdgeType = substitute ? 'substitute' : 'similar_to';
    addEdge(
      makeEdge(
        type,
        pair.a.node_key,
        pair.b.node_key,
        score,
        {
          jaccard: round(pair.similarity, 3),
          price_compat: round(pair.priceCompat, 3),
          same_shop: !!sameShop,
          same_brand: pair.a.brand === pair.b.brand,
          shared: pair.shared,
        },
        false,
      ),
    );
    neighborCount.set(pair.a.node_key, (neighborCount.get(pair.a.node_key) ?? 0) + 1);
    neighborCount.set(pair.b.node_key, (neighborCount.get(pair.b.node_key) ?? 0) + 1);
  }

  // listing ที่เป็นสินค้ารุ่นเดียวกัน (canonical product) — ไม่ได้ยุบข้อมูล แค่ลิงก์
  for (const pair of extras.canonical_pairs ?? []) {
    addEdge(makeEdge('same_product_as', pair.source, pair.target, pair.weight, pair.evidence, false));
  }

  // complements: สินค้าต่างชนิดในร้านเดียวกัน (cross-sell inventory)
  for (const [shopId, agg] of shopAgg) {
    if (agg.count < 2) continue;
    const inShop = products.filter((p) => shopNodeId(p) === shopId);
    for (let i = 0; i < inShop.length; i++) {
      for (let j = i + 1; j < inShop.length; j++) {
        const a = inShop[i];
        const b = inShop[j];
        if (a.product_type === b.product_type) continue;
        if (!a.product_type || !b.product_type) continue;
        const priceCompat = a.price > 0 && b.price > 0
          ? Math.min(a.price, b.price) / Math.max(a.price, b.price)
          : 0.5;
        const weight = 0.35 + priceCompat * 0.15 + (a.category === b.category ? 0.05 : 0);
        addEdge(
          makeEdge('complements', a.node_key, b.node_key, weight, {
            reason: 'same_shop_different_type',
            shop_id: a.shop_id,
            price_compat: round(priceCompat, 3),
          }, false),
        );
      }
    }
  }

  const graph: Graph = {
    directed: false,
    generated_at: new Date().toISOString(),
    nodes,
    edges,
    stats: emptyStats(),
  };
  graph.stats = computeStats(graph);
  return graph;
}

function emptyStats(): NetworkStats {
  return {
    node_count: 0,
    edge_count: 0,
    product_count: 0,
    by_node_type: {},
    by_edge_type: {},
    density: 0,
    avg_degree: 0,
    max_degree: 0,
    isolates: [],
    isolate_ratio: 0,
    components: 0,
    component_sizes: [],
    largest_component: 0,
    clustering: 0,
    top_hubs: [],
    readiness: 0,
    readiness_breakdown: {},
  };
}

export function computeStats(graph: Graph): NetworkStats {
  const byNodeType: Record<string, number> = {};
  for (const n of graph.nodes) byNodeType[n.type] = (byNodeType[n.type] ?? 0) + 1;
  const byEdgeType: Record<string, number> = {};
  for (const e of graph.edges) byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1;

  const productNodes = graph.nodes.filter((n) => n.type === 'product');
  const productIds = new Set(productNodes.map((n) => n.id));
  const productEdges = graph.edges.filter(
    (e) => productIds.has(e.source) && productIds.has(e.target),
  );

  // adjacency (product-product only)
  const adj = new Map<string, Set<string>>();
  for (const id of productIds) adj.set(id, new Set());
  for (const e of productEdges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const degrees = [...adj.entries()].map(([, set]) => set.size);
  const productCount = productNodes.length;
  const possible = (productCount * (productCount - 1)) / 2;
  const isolates = [...adj.entries()].filter(([, set]) => set.size === 0).map(([id]) => id);
  const avgDegree = degrees.length ? degrees.reduce((a, b) => a + b, 0) / degrees.length : 0;
  const maxDegree = degrees.length ? Math.max(...degrees) : 0;

  // components
  const ids = [...productIds];
  const index = new Map(ids.map((id, i) => [id, i]));
  const uf = unionFind(ids.length);
  for (const e of productEdges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a != null && b != null) uf.union(a, b);
  }
  const compSizes = new Map<number, number>();
  for (let i = 0; i < ids.length; i++) {
    const r = uf.find(i);
    compSizes.set(r, (compSizes.get(r) ?? 0) + 1);
  }
  const componentSizes = [...compSizes.values()].sort((a, b) => b - a);

  // clustering (average local coefficient)
  let clusteringSum = 0;
  let clusteringN = 0;
  for (const [id, neighbors] of adj) {
    if (neighbors.size < 2) continue;
    const list = [...neighbors];
    let links = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (adj.get(list[i])?.has(list[j])) links++;
      }
    }
    const possibleLocal = (list.length * (list.length - 1)) / 2;
    clusteringSum += links / possibleLocal;
    clusteringN++;
  }
  const clustering = clusteringN ? clusteringSum / clusteringN : 0;

  // hubs
  const hubs: Hub[] = [];
  for (const n of graph.nodes) {
    if (n.type === 'product') {
      const deg = adj.get(n.id)?.size ?? 0;
      if (deg > 0) hubs.push({ id: n.id, label: n.label, type: n.type, degree: deg, weight: n.weight });
    } else if (n.type === 'shop' || n.type === 'brand' || n.type === 'category') {
      const deg = Number(n.attributes.product_count ?? n.weight ?? 0);
      hubs.push({ id: n.id, label: n.label, type: n.type, degree: deg, weight: n.weight });
    }
  }
  const topHubs = hubs.sort((a, b) => b.degree - a.degree).slice(0, 10);

  const isolateRatio = productCount ? isolates.length / productCount : 1;
  const categoryIds = new Set(graph.nodes.filter((n) => n.type === 'category').map((n) => n.id));
  const brandIds = new Set(graph.nodes.filter((n) => n.type === 'brand').map((n) => n.id));
  const typeIds = new Set(graph.nodes.filter((n) => n.type === 'product_type').map((n) => n.id));
  const provinceIds = new Set(graph.nodes.filter((n) => n.type === 'province').map((n) => n.id));

  const productOut = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = productOut.get(e.source) ?? [];
    list.push(e);
    productOut.set(e.source, list);
  }
  const coverage = (ids: Set<string>) => {
    if (!productCount) return 0;
    let covered = 0;
    for (const p of productIds) {
      if ((productOut.get(p) ?? []).some((e) => ids.has(e.target) && e.target !== p)) covered++;
    }
    return covered / productCount;
  };

  const identity = (() => {
    let ok = 0;
    for (const p of productNodes) {
      if (p.attributes.product_id && p.attributes.shop_id) ok++;
    }
    return productCount ? ok / productCount : 0;
  })();
  const attrCoverage = (coverage(categoryIds) + coverage(typeIds) + coverage(brandIds) + coverage(provinceIds)) / 4;
  const connectivity = 1 - isolateRatio;
  const redundancy = Math.min(1, avgDegree / 3);
  const size = Math.min(1, Math.log10(productCount + 1) / 2);
  const quality = productCount
    ? productNodes.reduce((n, p) => n + Number(p.attributes.quality_score ?? 0), 0) / productCount / 100
    : 0;

  const breakdown = {
    identity: round(identity * 100, 1),
    attributes: round(attrCoverage * 100, 1),
    connectivity: round(connectivity * 100, 1),
    redundancy: round(redundancy * 100, 1),
    sample_size: round(size * 100, 1),
    record_quality: round(quality * 100, 1),
  };
  const readiness =
    identity * 0.15 +
    attrCoverage * 0.2 +
    connectivity * 0.25 +
    redundancy * 0.15 +
    size * 0.1 +
    quality * 0.15;

  return {
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    product_count: productCount,
    by_node_type: byNodeType,
    by_edge_type: byEdgeType,
    density: possible > 0 ? round(productEdges.length / possible, 4) : 0,
    avg_degree: round(avgDegree, 2),
    max_degree: maxDegree,
    isolates,
    isolate_ratio: round(isolateRatio, 3),
    components: componentSizes.length,
    component_sizes: componentSizes.slice(0, 20),
    largest_component: componentSizes[0] ?? 0,
    clustering: round(clustering, 3),
    top_hubs: topHubs,
    readiness: Math.round(readiness * 100),
    readiness_breakdown: breakdown,
  };
}

/** สร้าง graph ย่อยสำหรับ API / UI (กรองชนิด node/edge) */
export function filterGraph(
  graph: Graph,
  opts: { nodeTypes?: NodeType[]; edgeTypes?: EdgeType[]; limit?: number } = {},
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeTypes = opts.nodeTypes?.length ? new Set(opts.nodeTypes) : null;
  const edgeTypes = opts.edgeTypes?.length ? new Set(opts.edgeTypes) : null;
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));

  const edges = graph.edges
    .filter((e) => !edgeTypes || edgeTypes.has(e.type))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.source);
    ids.add(e.target);
  }
  const nodes = graph.nodes.filter((n) => ids.has(n.id) && (!nodeTypes || nodeTypes.has(n.type)));
  return { nodes, edges };
}
