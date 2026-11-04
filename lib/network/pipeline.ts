import type {
  CleanChange,
  DroppedRecord,
  MergeRecord,
  NormalizedProduct,
  PipelineConfig,
  PipelineResult,
  SourceId,
} from './types';
import { auditNormalizedProducts, auditRawProducts } from './audit';
import { buildGraph } from './graph';
import { normalizeProduct } from './normalize';
import { attachPriceSegments } from './enrich';
import { assignCanonical, canonicalEdgePairs } from './canonical';
import type { CanonicalSummary } from './types';
import { nameKey } from './text';
import { VISUAL_ATTR_IDS } from './vocab';
import { detectAllConflicts } from './conflicts';
import { validateEnrichment } from './validate-enrichment';
import { attachGate } from './gate';

export const DEFAULT_CONFIG: PipelineConfig = {
  source: 'db',
  dedupe: 'merge',
  drop_invalid_identity: true,
  build_similarity: true,
  similarity_threshold: 0.34,
  max_neighbors: 8,
  max_pair_candidates: 250,
  edge_min_confidence: 0.6,
  attribute_overlap_min: 0.5,
  gate_max_age_days: 7,
  variant_nodes: false,
  canonicalize: 'evidence',
  canonical_threshold: 0.8,
  enrich_nodes: true,
  enrich_min_confidence: 0.5,
  ai_enrich: true,
  ai_min_confidence: 0.55,
  ai_max_records_per_run: 150,
  ai_nodes: false,
  phrase_memory: true,
  ai_gate_min_text_fields: 2,
  ai_focus_ai_only: false,
  vision_enrich: true,
  vision_max_records_per_run: 25,
  build_graph: true,
};

function platformOf(raw: any): string {
  const ext = String(raw.ext ?? '').trim();
  const parts = ext.split(':');
  const declared = String(raw.plat ?? raw.platform ?? parts[0] ?? '').trim().toLowerCase();
  return declared || 'shopee';
}

/**
 * กุญแจตัวตนของ listing — ต้องมี platform ด้วย
 * ไม่งั้น Shopee/TikTok ที่เลข shop/product บังเอิญตรงกันจะถูก merge เป็นชิ้นเดียว
 */
function identityKey(raw: any): string {
  const ext = String(raw.ext ?? '').trim();
  const parts = ext.split(':');
  const platform = platformOf(raw);
  const shop = String(raw.shop_id ?? parts[1] ?? '').trim();
  const pid = String(raw.product_id ?? parts[2] ?? '').trim();
  if (pid && shop) return `${platform}:${shop}:${pid}`;
  if (pid) return `${platform}:pid:${pid}`;
  if (ext) return `ext:${ext}`;
  return `anon:${Math.random().toString(36).slice(2)}`;
}

function richness(raw: any): number {
  let score = 0;
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === '_raw' || k === '_duplicates') continue;
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) score += v.length > 0 ? 2 : 0;
    else if (typeof v === 'object') score += Object.keys(v).length > 0 ? 2 : 0;
    else score += 1;
  }
  if (Array.isArray(raw?.specs)) score += raw.specs.length * 0.5;
  return score;
}

function mergeRaw(records: any[]): any {
  const sorted = [...records].sort((a, b) => richness(b) - richness(a));
  const base = { ...sorted[0] };
  const specs = new Map<string, { name: string; value: string }>();
  for (const r of sorted) {
    for (const s of Array.isArray(r.specs) ? r.specs : []) {
      const key = String(s?.name ?? '').trim().toLowerCase();
      if (key && s?.value && !specs.has(key)) specs.set(key, { name: String(s.name), value: String(s.value) });
    }
    for (const key of ['monthly_sold', 'historical_sold', 'review_count']) {
      const a = Number(base[key]);
      const b = Number(r[key]);
      if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) base[key] = b;
    }
    for (const [k, v] of Object.entries(r)) {
      if (v === undefined || v === null || v === '') continue;
      if (base[k] === undefined || base[k] === null || base[k] === '') base[k] = v;
    }
    // ใช้ข้อมูลล่าสุดเท่าที่มี
    if (r.last_ingested_at && (!base.last_ingested_at || String(r.last_ingested_at) > String(base.last_ingested_at))) {
      base.last_ingested_at = r.last_ingested_at;
    }
  }
  if (specs.size) base.specs = [...specs.values()];
  base._duplicates = records.length;
  return base;
}

function dedupeProducts(
  rawList: any[],
  mode: PipelineConfig['dedupe'],
): { records: any[]; merged: MergeRecord[] } {
  if (mode === 'keep-first') {
    const seen = new Set<string>();
    const records: any[] = [];
    for (const raw of rawList) {
      const key = identityKey(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(raw);
    }
    return { records, merged: [] };
  }

  const groups = new Map<string, any[]>();
  for (const raw of rawList) {
    const key = identityKey(raw);
    const list = groups.get(key) ?? [];
    list.push(raw);
    groups.set(key, list);
  }

  const records: any[] = [];
  const merged: MergeRecord[] = [];
  for (const [key, list] of groups) {
    if (list.length === 1) {
      records.push(list[0]);
      continue;
    }
    if (mode === 'keep-richest') {
      const winner = [...list].sort((a, b) => richness(b) - richness(a))[0];
      records.push(winner);
    } else {
      records.push(mergeRaw(list));
    }
    merged.push({
      key,
      kept_from: list[0]?.ext ?? list[0]?.product_id ?? key,
      merged: list.length - 1,
      product_ids: list.map((p) => p.product_id ?? p.ext),
    });
  }
  return { records, merged };
}

export function runPipeline(rawProducts: any[], config: Partial<PipelineConfig> = {}): PipelineResult {
  const start = Date.now();
  const cfg: PipelineConfig = { ...DEFAULT_CONFIG, ...config };
  const source: SourceId = cfg.source;

  const report_before = auditRawProducts(rawProducts, `${source} (raw)`);
  const { records: deduped, merged } = dedupeProducts(rawProducts, cfg.dedupe);

  const dropped: DroppedRecord[] = [];
  const products: NormalizedProduct[] = [];
  const changes: CleanChange[] = [];

  for (const raw of deduped) {
    const { product, changes: c } = normalizeProduct(raw);
    if (cfg.drop_invalid_identity && (!product.product_id || !product.shop_id)) {
      dropped.push({
        product_id: product.product_id || product.ext,
        name: product.name.slice(0, 60),
        reason: !product.product_id ? 'missing product_id' : 'missing shop_id',
        original: {
          ext: raw.ext,
          name: raw.name,
          shop_id: raw.shop_id,
          product_id: raw.product_id,
        },
      });
      continue;
    }
    if (!product.name) {
      dropped.push({
        product_id: product.product_id || product.ext,
        name: '',
        reason: 'empty name',
        original: { ext: raw.ext, shop_name: raw.shop_name },
      });
      continue;
    }
    products.push(product);
    changes.push(...c);
  }

  // ตั้งธงชื่อซ้ำในร้านเดียวกัน — ใช้ตัดสินว่าต้อง merge ด้วยมือหรือไม่
  const nameGroups = new Map<string, NormalizedProduct[]>();
  for (const p of products) {
    const key = `${p.shop_id}|${nameKey(p.name)}`;
    const list = nameGroups.get(key) ?? [];
    list.push(p);
    nameGroups.set(key, list);
  }
  for (const group of nameGroups.values()) {
    if (group.length > 1) for (const p of group) p.quality_flags.push('duplicate_name');
  }

  const canonical: CanonicalSummary = assignCanonical(products, cfg);

  // price segment ต้องเทียบทั้งชุด (median/quantile ต่อหมวด)
  attachPriceSegments(products);

  // Layer 3: dedupe/hierarchy/require-evidence ก่อนสร้างกราฟ/audit
  validateEnrichment(products);

  // Trust Gate — ทุกสินค้าต้องมีสถานะก่อนถูกจัดอันดับ (auto-run ก็ได้ด้วย)
  const gate = attachGate(products, { maxAgeDays: cfg.gate_max_age_days });

  const graph = cfg.build_graph
    ? buildGraph(
        products,
        {
          similarity_threshold: cfg.similarity_threshold,
          max_neighbors: cfg.max_neighbors,
          max_pair_candidates: cfg.max_pair_candidates,
          edge_min_confidence: cfg.edge_min_confidence,
          attribute_overlap_min: cfg.attribute_overlap_min,
          variant_nodes: cfg.variant_nodes,
          enrich_nodes: cfg.enrich_nodes,
          enrich_min_confidence: cfg.enrich_min_confidence,
          ai_nodes: cfg.ai_nodes,
        },
        { canonical_pairs: canonical.linked > 0 ? canonicalEdgePairs(products) : [] },
      )
    : null;
  const report_after = auditNormalizedProducts(products, `${source} (network-ready)`, graph ?? undefined, canonical);

  // merged info → change log แบบอ่านได้
  for (const m of merged) {
    changes.push({
      product_id: m.key,
      field: '_merge',
      before: m.merged + 1,
      after: 1,
      rule: `dedupe:${cfg.dedupe}`,
    });
  }

  return {
    source,
    generated_at: new Date().toISOString(),
    input_count: rawProducts.length,
    kept_count: products.length,
    dropped,
    merged,
    changes,
    report_before,
    report_after,
    products,
    graph,
    canonical,
    elapsed_ms: Date.now() - start,
    config: cfg,
  };
}

export function pipelineSummary(result: PipelineResult) {
  const stats = result.graph?.stats ?? null;
  const gate = { pass: 0, review: 0, blocked: 0 };
  const risk = { low: 0, medium: 0, high: 0 };
  for (const p of result.products) {
    if (p.gate) gate[p.gate.status] += 1;
    if (p.trust_risk) risk[p.trust_risk.level] += 1;
  }
  return {
    source: result.source,
    input: result.input_count,
    kept: result.kept_count,
    dropped: result.dropped.length,
    merged: result.merged.reduce((n, m) => n + m.merged, 0),
    changes: result.changes.length,
    graph_built: Boolean(stats),
    gate,
    risk,
    nodes: stats?.node_count ?? 0,
    edges: stats?.edge_count ?? 0,
    isolates: stats?.isolates.length ?? 0,
    components: stats?.components ?? 0,
    score_before: result.report_before.score,
    score_after: result.report_after.score,
    readiness: result.report_after.readiness,
    canonical_groups: result.canonical.groups,
    variant_nodes: stats?.by_node_type.variant ?? 0,
    enrich_nodes:
      (stats?.by_node_type.use_case ?? 0) +
      (stats?.by_node_type.function ?? 0) +
      (stats?.by_node_type.context ?? 0) +
      (stats?.by_node_type.style ?? 0) +
      (stats?.by_node_type.space ?? 0) +
      (stats?.by_node_type.price_segment ?? 0),
    ai_nodes: stats?.by_node_type.ai_attribute ?? 0,
    /** แถวที่ยังไม่เคยอ่านภาพ (ใช้เป็นตัวเลขบนปุ่ม "เติมข้อมูลจากภาพ") */
    vision_missing: result.products.filter(
      (p) =>
        !p.ai?.meta?.vision &&
        Boolean(p.image || p.images?.length) &&
        !(p.ai?.tags ?? []).some((t) => VISUAL_ATTR_IDS.includes(t.attribute as any)),
    ).length,
    /** จำนวนค่าที่มาจากพจนานุกรมวลี (ไม่เสียค่า API) */
    phrase_values: result.products.reduce(
      (n, p) => n + (p.ai?.tags ?? []).filter((t) => t.origin === 'phrase').length,
      0,
    ),
    /** จำนวนค่าที่ AI ขัดกับหลักฐานและรอคนตรวจ */
    conflict_pending: detectAllConflicts(result.products).length,
    elapsed_ms: result.elapsed_ms,
  };
}
