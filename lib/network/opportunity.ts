/**
 * Opportunity engine — Proven / Hidden / Emerging
 * ------------------------------------------------
 * deterministic ล้วน (ไม่เรียก LLM): centrality + demand + audience fit + Trust Gate
 * ทุกผลลัพธ์ต้องพา evidence และคำอธิบายไทยที่อ้างค่าจริงไปด้วย
 */
import type {
  EdgeType,
  Graph,
  GraphEdge,
  NormalizedProduct,
  Opportunity,
  OpportunityClass,
  OpportunityDiagnostics,
  OpportunityEvidence,
  OpportunityMetrics,
  TrustRiskLevel,
} from './types';
import { GRAPH_RULES, semanticTags } from './graph-rules';
import { TRUST_RISK_RULES } from './trust';

/** edge ที่ใช้คิด centrality (ไม่รวม same_product_as ซึ่งเป็นตัวตนเดียวกัน) */
const CENTRALITY_EDGES: EdgeType[] = [
  'similar_to',
  'substitute',
  'complements',
  'same_context',
  'used_with',
];

const OPP_RULES = {
  proven_sold_pct: 0.6,
  proven_degree_pct: 0.6,
  hidden_audience_fit: 0.55,
  hidden_degree_pct: 0.5,
  hidden_min_rating: 4.5,
  emerging_age_days: 30,
  emerging_max_reviews: 50,
  emerging_demand_pct: 0.6,
  risk_penalty_medium: 0.05,
  risk_penalty_high: 0.15,
  evidence_limit: 5,
} as const;

const CLASS_ORDER: Record<OpportunityClass, number> = { proven: 0, hidden: 1, emerging: 2 };

export interface OpportunityReport {
  items: Opportunity[];
  diagnostics: OpportunityDiagnostics;
  gate_counts: { pass: number; review: number; blocked: number };
  class_counts: Record<OpportunityClass, number>;
}

/* ── helpers ─────────────────────────────────────────────────── */

/** percentile แบบ deterministic: (#ค่า < x) / (n-1) */
export function percentile(sortedAsc: number[], value: number): number {
  const n = sortedAsc.length;
  if (n <= 1) return 0;
  let less = 0;
  for (const v of sortedAsc) {
    if (v < value) less += 1;
    else break;
  }
  return Math.min(1, less / (n - 1));
}

function productPairsFromGraph(graph: Graph): GraphEdge[] {
  const productIds = new Set(graph.nodes.filter((n) => n.type === 'product').map((n) => n.id));
  return graph.edges.filter(
    (e) =>
      CENTRALITY_EDGES.includes(e.type) && productIds.has(e.source) && productIds.has(e.target),
  );
}

export interface Centrality {
  degree: number;
  strength: number;
  pagerank: number;
}

/**
 * PageRank บน product-product graph (undirected → กระจายสองทาง)
 * - damping 0.85, 30 รอบ, init เท่ากัน, จัดการ dangling node
 */
export function computeCentrality(keys: string[], edges: GraphEdge[]): Map<string, Centrality> {
  const ids = [...keys].sort();
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const outWeight = new Array<number>(n).fill(0);
  const degree = new Array<number>(n).fill(0);
  const adj: Array<Array<{ j: number; w: number }>> = Array.from({ length: n }, () => []);

  for (const e of edges) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a == null || b == null || a === b) continue;
    const w = Number.isFinite(e.weight) ? Math.max(0, e.weight) : 0;
    adj[a].push({ j: b, w });
    adj[b].push({ j: a, w });
    outWeight[a] += w;
    outWeight[b] += w;
    degree[a] += 1;
    degree[b] += 1;
  }

  const rank = new Array<number>(n).fill(n > 0 ? 1 / n : 0);
  const next = new Array<number>(n).fill(0);
  const damping = 0.85;
  for (let iter = 0; iter < 30 && n > 0; iter++) {
    const base = (1 - damping) / n;
    next.fill(base);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (outWeight[i] <= 0) {
        dangling += rank[i];
        continue;
      }
      const factor = (damping * rank[i]) / outWeight[i];
      for (const link of adj[i]) next[link.j] += factor * link.w;
    }
    if (dangling > 0) {
      const share = (damping * dangling) / n;
      for (let i = 0; i < n; i++) next[i] += share;
    }
    let sum = 0;
    for (const v of next) sum += v;
    for (let i = 0; i < n; i++) rank[i] = sum > 0 ? next[i] / sum : next[i];
  }

  const out = new Map<string, Centrality>();
  ids.forEach((id, i) => {
    out.set(id, {
      degree: degree[i],
      strength: Math.round(outWeight[i] * 1000) / 1000,
      pagerank: Math.round(rank[i] * 1e6) / 1e6,
    });
  });
  return out;
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function riskNote(p: NormalizedProduct): string | null {
  const risk = p.trust_risk;
  if (!risk) return null;
  if (risk.policy.strict_return) return '⚠ ร้านไม่รับเคลม/คืนหลังยืนยัน';
  if (risk.flags.includes('severe_damage_cluster')) {
    return `⚠ รีวิว 1–2 ดาวแจ้งเสียหาย ${risk.review.damage_mentions} ครั้ง${
      risk.policy.claim_support ? ' (ร้านรับเคลม)' : ''
    }`;
  }
  if (risk.flags.includes('has_damage_complaints')) {
    return `มีรีวิวแจ้งเสียหาย ${risk.review.damage_mentions} ครั้ง`;
  }
  return null;
}

function explain(
  cls: OpportunityClass,
  p: NormalizedProduct,
  m: OpportunityMetrics,
  evidence: OpportunityEvidence[],
): string {
  const top = evidence[0];
  const risk = riskNote(p);
  if (cls === 'proven') {
    const parts = [
      `ขายแล้ว ${p.historical_sold.toLocaleString('th-TH')} ชิ้น (top ${fmtPct(1 - m.sold_pct)})`,
      `มีการเชื่อมต่อ ${m.degree} เส้น (top ${fmtPct(1 - m.degree_pct)})`,
      `gate ผ่านครบ`,
    ];
    if (top) {
      parts.push(`เชื่อมกับ "${top.other.name}" (${top.edge_type})`);
    }
    if (risk) parts.push(risk);
    return parts.join(' · ');
  }
  if (cls === 'hidden') {
    const parts = [
      `Audience Fit ${fmtPct(m.audience_fit)}`,
      `แต่มี connection เพียง ${m.degree} เส้น (ต่ำกว่า ${fmtPct(1 - m.degree_pct)} ของสินค้าทั้งหมด)`,
    ];
    if (m.rating != null) parts.push(`คะแนน ${m.rating.toFixed(2)}`);
    if (m.audience) parts.push(`กลุ่ม "${m.audience}"`);
    if (risk) parts.push(risk);
    return parts.join(' · ');
  }
  const parts = [
    `ใหม่ ${m.listing_age_days ?? '?'} วัน`,
    `ยอดขายเร่งตัว (${p.monthly_sold.toLocaleString('th-TH')}/เดือน)`,
    `รีวิว ${p.review_count.toLocaleString('th-TH')} รายการ`,
  ];
  if (m.risk_level) parts.push(`risk ${m.risk_level}`);
  if (top) parts.push(`เชื่อมกับ "${top.other.name}" (${top.edge_type})`);
  return parts.join(' · ');
}

/* ── main ───────────────────────────────────────────────────── */

export function computeOpportunities(
  products: NormalizedProduct[],
  graph: Graph,
  opts: { now?: Date } = {},
): OpportunityReport {
  const nowMs = (opts.now ?? new Date()).getTime();
  /** อายุ listing: ใช้ listing_age_days ก่อน ถ้าไม่มีค่อยนับจาก first_seen_at */
  const effectiveAge = (p: NormalizedProduct): number | null => {
    if (typeof p.listing_age_days === 'number' && Number.isFinite(p.listing_age_days)) {
      return p.listing_age_days;
    }
    if (p.first_seen_at) {
      const t = Date.parse(p.first_seen_at);
      if (!Number.isNaN(t)) return Math.max(0, (nowMs - t) / 86400000);
    }
    return null;
  };
  const byKey = new Map(products.map((p) => [p.node_key, p]));
  const keys = products.map((p) => p.node_key);
  const pairEdges = productPairsFromGraph(graph);
  const centrality = computeCentrality(keys, pairEdges);

  // demand ของแต่ละแท็ก (นับยอดขายเฉพาะสินค้าที่ gate ผ่าน)
  const demand = new Map<string, number>();
  const tagCache = new Map<string, ReturnType<typeof semanticTags>>();
  for (const p of products) {
    const tags = semanticTags(p, GRAPH_RULES.edge_min_confidence);
    tagCache.set(p.node_key, tags);
    if (p.gate?.status !== 'pass') continue;
    for (const tag of tags) {
      demand.set(tag.key, (demand.get(tag.key) ?? 0) + Math.max(0, p.historical_sold));
    }
  }
  const maxDemand = Math.max(1, ...demand.values());
  const share = (key: string) => Math.min(1, (demand.get(key) ?? 0) / maxDemand);

  // sold percentile (เฉพาะสินค้าที่มี gate)
  const soldValues = products
    .filter((p) => p.gate)
    .map((p) => Math.max(0, p.historical_sold))
    .sort((a, b) => a - b);
  const degreeValues = keys
    .map((k) => centrality.get(k)?.degree ?? 0)
    .sort((a, b) => a - b);

  // context demand ต่อสินค้า แล้วแปลงเป็น percentile ของทั้งชุด
  const contextDemand = new Map<string, number>();
  for (const p of products) {
    const tags = tagCache.get(p.node_key) ?? [];
    let best = 0;
    for (const tag of tags) {
      if (tag.prefix !== 'ctx' && tag.prefix !== 'use' && tag.prefix !== 'space') continue;
      best = Math.max(best, share(tag.key));
    }
    contextDemand.set(p.node_key, best);
  }
  const contextValues = [...contextDemand.values()].sort((a, b) => a - b);

  const gateCounts = { pass: 0, review: 0, blocked: 0 };
  const riskCounts: Record<TrustRiskLevel, number> = { low: 0, medium: 0, high: 0 };
  const datasourceTierCounts: Record<string, number> = {};
  let withReviewSamples = 0;
  let withoutReviews = 0;
  let withPolicyText = 0;
  for (const p of products) {
    if (p.gate) gateCounts[p.gate.status] += 1;
    if (p.trust_risk) {
      riskCounts[p.trust_risk.level] += 1;
      if (p.trust_risk.review.sampled > 0) withReviewSamples += 1;
      else withoutReviews += 1;
      if (p.trust_risk.policy.source === 'description') withPolicyText += 1;
    } else {
      withoutReviews += 1;
    }
    const tier = p.datasource_tier;
    if (tier) datasourceTierCounts[tier] = (datasourceTierCounts[tier] ?? 0) + 1;
  }

  const items: Opportunity[] = [];
  const classCounts: Record<OpportunityClass, number> = { proven: 0, hidden: 0, emerging: 0 };

  for (const p of products) {
    const gate = p.gate;
    if (!gate || gate.status === 'blocked') continue;

    const c = centrality.get(p.node_key) ?? { degree: 0, strength: 0, pagerank: 0 };
    const tags = tagCache.get(p.node_key) ?? [];
    const soldPct = percentile(soldValues, Math.max(0, p.historical_sold));
    const degreePct = percentile(degreeValues, c.degree);
    const demandPct = percentile(contextValues, contextDemand.get(p.node_key) ?? 0);

    let audienceFit = 0;
    let audienceFitBasis: OpportunityMetrics['audience_fit_basis'] = 'none';
    let audienceLabel: string | null = null;
    for (const tag of tags) {
      if (tag.prefix !== 'aud') continue;
      const fit = tag.confidence * share(tag.key);
      if (fit > audienceFit) {
        audienceFit = fit;
        audienceLabel = tag.label;
      }
    }
    if (audienceFit > 0) audienceFitBasis = 'audience';
    else {
      for (const tag of tags) {
        if (tag.prefix !== 'ctx' && tag.prefix !== 'use' && tag.prefix !== 'space') continue;
        const fit = tag.confidence * share(tag.key) * 0.75;
        if (fit > audienceFit) {
          audienceFit = fit;
          audienceLabel = tag.label;
        }
      }
      if (audienceFit > 0) audienceFitBasis = 'context_fallback';
    }

    const rating = p.rating ?? null;
    const ageDays = effectiveAge(p);
    const risk = p.trust_risk ?? null;
    const riskPenalty =
      risk?.level === 'high'
        ? OPP_RULES.risk_penalty_high
        : risk?.level === 'medium'
          ? OPP_RULES.risk_penalty_medium
          : 0;
    const metrics: OpportunityMetrics = {
      degree: c.degree,
      strength: c.strength,
      pagerank: c.pagerank,
      degree_pct: Math.round(degreePct * 1000) / 1000,
      sold_pct: Math.round(soldPct * 1000) / 1000,
      context_demand_pct: Math.round(demandPct * 1000) / 1000,
      audience_fit: Math.round(audienceFit * 1000) / 1000,
      audience_fit_basis: audienceFitBasis,
      audience: audienceLabel,
      rating,
      listing_age_days: ageDays,
      risk_level: risk?.level ?? null,
      risk_penalty: riskPenalty,
    };

    const isNew = ageDays != null && ageDays < OPP_RULES.emerging_age_days;
    const isFast =
      p.features?.velocity_band === 'Fast' ||
      (p.historical_sold > 0 && p.monthly_sold / p.historical_sold >= 0.5);

    let cls: OpportunityClass | null = null;
    let baseScore = 0;
    if (isNew) {
      // lifecycle-first: สินค้าใหม่ต้องเป็น Emerging เท่านั้น ไม่ใช่ Proven
      if (
        isFast &&
        p.review_count < OPP_RULES.emerging_max_reviews &&
        risk?.level !== 'high'
      ) {
        cls = 'emerging';
        baseScore =
          0.6 * demandPct +
          0.4 * (1 - Math.min(1, (ageDays ?? 0) / OPP_RULES.emerging_age_days));
      }
    } else if (
      gate.status === 'pass' &&
      soldPct >= OPP_RULES.proven_sold_pct &&
      degreePct >= OPP_RULES.proven_degree_pct
    ) {
      cls = 'proven';
      baseScore = 0.5 * soldPct + 0.3 * degreePct + 0.2 * Math.min(1, (rating ?? 0) / 5);
    } else if (
      gate.status === 'pass' &&
      audienceFit >= OPP_RULES.hidden_audience_fit &&
      degreePct <= OPP_RULES.hidden_degree_pct &&
      (rating ?? 0) >= OPP_RULES.hidden_min_rating &&
      soldPct < OPP_RULES.proven_sold_pct
    ) {
      cls = 'hidden';
      baseScore = 0.5 * audienceFit + 0.3 * (1 - degreePct) + 0.2 * Math.min(1, (rating ?? 0) / 5);
    }
    if (!cls) continue;
    const score = Math.max(0, baseScore - riskPenalty);

    const incident = pairEdges
      .filter((e) => e.source === p.node_key || e.target === p.node_key)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, OPP_RULES.evidence_limit);
    const evidence: OpportunityEvidence[] = [];
    for (const e of incident) {
      const otherKey = e.source === p.node_key ? e.target : e.source;
      const other = byKey.get(otherKey);
      if (!other) continue;
      evidence.push({
        edge_type: e.type,
        weight: e.weight,
        other: { node_key: other.node_key, name: other.name, url: other.url },
        shared: {
          contexts: Array.isArray(e.evidence?.shared_contexts) ? e.evidence.shared_contexts : [],
          use_cases: Array.isArray(e.evidence?.shared_use_cases) ? e.evidence.shared_use_cases : [],
          functions: Array.isArray(e.evidence?.shared_functions) ? e.evidence.shared_functions : [],
        },
        ...(typeof e.evidence?.quote === 'string' ? { quote: e.evidence.quote } : {}),
      });
    }

    // ต้องอ้างหลักฐานได้จริงเสมอ (ไม่แนะนำแบบลอย ๆ ที่ไม่มี edge ให้ตรวจย้อน)
    if (evidence.length === 0) continue;

    classCounts[cls] += 1;
    items.push({
      node_key: p.node_key,
      ext: p.ext,
      name: p.name,
      image: p.image,
      url: p.url,
      price: p.price,
      historical_sold: p.historical_sold,
      class: cls,
      internal_tier: cls,
      datasource_tier: p.datasource_tier ?? null,
      score: Math.round(score * 1000) / 1000,
      gate,
      trust_risk: risk,
      metrics,
      evidence,
      explain_th: explain(cls, p, metrics, evidence),
    });
  }

  items.sort(
    (a, b) => CLASS_ORDER[a.class] - CLASS_ORDER[b.class] || b.score - a.score || a.name.localeCompare(b.name),
  );

  const ages = products
    .map((p) => effectiveAge(p))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const edgeCounts: Record<string, number> = {};
  for (const e of pairEdges) edgeCounts[e.type] = (edgeCounts[e.type] ?? 0) + 1;

  const notes: string[] = [];
  if (classCounts.emerging === 0) {
    const minAge = ages.length ? Math.min(...ages) : null;
    notes.push(
      `ยังไม่มีสินค้า Emerging เพราะต้องเป็นสินค้าอายุ < ${OPP_RULES.emerging_age_days} วัน + ยอดขายเร่งตัว + รีวิว < ${OPP_RULES.emerging_max_reviews}` +
        (minAge != null ? ` (สินค้าอายุน้อยที่สุดในชุดนี้ ${minAge} วัน)` : '') +
        ` · gate review มี ${gateCounts.review} รายการ`,
    );
  }
  if (riskCounts.high > 0) {
    notes.push(`Trust Risk ระดับสูง ${riskCounts.high} รายการ (รีวิวเสียหาย/นโยบายร้าน/ข้อมูลขัดแย้ง)`);
  }
  if (withoutReviews > 0) {
    notes.push(`ไม่พบข้อความรีวิว ${withoutReviews} รายการ — ประเมินความเสี่ยงจากรีวิวไม่ได้`);
  }
  if ((edgeCounts.used_with ?? 0) === 0) {
    notes.push(
      'ยังไม่มี used_with เพราะไม่พบวลี "ซื้อคู่/ใช้คู่กับ/พร้อมกัน/จัดชุด" ในข้อความสินค้า (ไม่สร้าง edge จากความคาดเดา)',
    );
  }

  const diagnostics: OpportunityDiagnostics = {
    note: notes.length ? notes.join(' · ') : null,
    min_listing_age_days: ages.length ? Math.min(...ages) : null,
    age_unknown: products.filter((p) => effectiveAge(p) == null).length,
    gate_review_count: gateCounts.review,
    risk_counts: riskCounts,
    review_coverage: {
      with_samples: withReviewSamples,
      without_reviews: withoutReviews,
      with_policy_text: withPolicyText,
    },
    datasource_tier_counts: datasourceTierCounts,
    edge_counts_by_type: edgeCounts,
    thresholds: { ...OPP_RULES, ...TRUST_RISK_RULES },
  };

  return { items, diagnostics, gate_counts: gateCounts, class_counts: classCounts };
}

/** เขียนผลกลับลง record เพื่อให้ snapshot/sync ส่งต่อได้ */
export function annotateOpportunities(products: NormalizedProduct[], report: OpportunityReport): void {
  const byKey = new Map(report.items.map((o) => [o.node_key, o]));
  for (const p of products) {
    const o = byKey.get(p.node_key);
    p.internal_tier = o?.class ?? null;
    p.opportunity = o ? { class: o.class, score: o.score, metrics: o.metrics } : null;
  }
}

/** ค่า default สำหรับ UI ตัวกรอง */
export const OPPORTUNITY_CLASSES: OpportunityClass[] = ['proven', 'hidden', 'emerging'];
