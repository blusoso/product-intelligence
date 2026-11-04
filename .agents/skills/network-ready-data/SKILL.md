---
name: network-ready-data
description: Turns scraped marketplace product JSON (Shopee/TikTok) into network-science-ready data - audits raw records, normalizes Thai names and prices, dedupes, assigns deterministic category/type/brand/place taxonomy, builds typed graph nodes and edges, scores readiness, and exports CSV/JSON. Use when the user asks to audit scraped product data, clean or normalize Thai product listings, build a product graph or nodes/edges, check graph readiness, or export network data from this app.
---

# Network-Ready Product Data

Convert ordinary scraped listings into records a network analysis can consume:
one canonical row per product, typed nodes, weighted edges, and a readiness
number that survives review.

## Workflow

Copy this checklist and keep it updated:

```
- [ ] 1. Audit the raw source
- [ ] 2. Fix causes, not the output
- [ ] 3. Rebuild the pipeline
- [ ] 4. Review & approve rows in /products
- [ ] 5. Check the numbers against thresholds
- [ ] 6. Export or sync
```

**0. Ingestion already runs the pipeline** (graph excluded)

`POST /api/ingest` schedules the background job automatically: normalize →
rule enrichment → AI enrichment (if `AI_API_KEY`) → canonical → price history →
audit → write to `products`. Check it with `GET /api/network/auto-run`.
Only the graph is manual (`POST /api/network/build`), and the auto report's
readiness is an estimate because no connectivity is measured without a graph.

AI tags are stored in `ai_enrichment` / `record.ai` and are **never** merged into
`enrichment` or factual columns (`price`, `*_cm`, `sold`, …). If you change the
vocabulary in `lib/network/vocab.ts`, bump `PROMPT_VERSION` in `lib/network/ai.ts`.

**Product Attributes (standard set).** `lib/network/attributes.ts` builds the same
18 attributes for every product, each value tagged `evidence` | `computed` |
`ai_inferred` | `manual`. Use `GET /api/network/attributes?ext=…` for one product,
`/api/network/attributes/summary` for coverage, and
`/api/network/export?part=attributes&format=csv` for the long-format dataset.
AI values always carry an `AI` badge in the UI and `source=ai_inferred` in exports;
human corrections carry `manual` / a “คนแก้” badge.

**Review & approve happens in `/products`** (not in `/network`). The queue tab
`รอตรวจ` shows one row at a time with every field, the 18 attributes (source-tagged)
and the AI tab; the reviewer can edit name/SKU/price/commission/product type/brand/
province/description and override an interpreted attribute before pressing
`อนุมัติ` (`a`) or `ตีกลับ` (`r`). The auto-pipeline status card + “เติมข้อมูล AI”
progress bar live at the top of that page. Edits are guarded: changed columns are
recorded in `products.manual_edits` and skipped by `applyCoreFields`, and
`attribute_overrides` is never touched by the pipeline.

**DeepSeek setup.** `AI_PROVIDER=deepseek`, `AI_API_KEY=…`, `AI_MODEL=deepseek-flash`
(default), `AI_THINKING=disabled`; then **restart dev server** and check
`GET /api/network/ai/health`. If AI was down, press “เติมข้อมูล AI” on `/products`
(or `POST /api/network/enrich-ai`) to backfill; it is incremental and cache-backed.
The button streams live progress (`?stream=1` NDJSON: stage → per-batch progress →
done) and can be cancelled mid-run; when nothing is missing it becomes
“เติมข้อมูล AI ซ้ำ” (`{force:true}`) for re-runs after a prompt/model change.
A single row can be re-run from its AI tab (`POST /api/products/:id/enrich-ai`).

**1. Audit the raw source**

```bash
curl "http://localhost:3000/api/network/audit?source=db"      # Supabase
curl "http://localhost:3000/api/network/audit?source=file"    # data/products.json
```

Read `report_before.sections` — each finding has `severity`, `count`, `samples`.
Never start editing code before you know which finding dominates.

**2. Fix causes, not the output**

| Finding | Fix in |
|---|---|
| wrong `category` / `product_type` | `lib/network/taxonomy.ts` (keywords) |
| mojibake, promo text in names | `lib/network/text.ts` |
| price/sold/rating nonsense | `lib/network/normalize.ts` |
| duplicate listings | `lib/network/pipeline.ts` (`dedupeProducts`) |
| missing edges / isolates | `lib/network/graph.ts` |

**3. Rebuild**

```bash
curl -X POST http://localhost:3000/api/network/build \
  -H "Content-Type: application/json" \
  -d '{"source":"db","apply":true,"sync_db":false,"dedupe":"merge"}'
```

`apply` writes `data/network/graph.json`; `sync_db` additionally updates core
product fields (it touches only core columns, never `_raw` or workflow state).

**4. Check the numbers**

| Metric | Target | Meaning |
|---|---|---|
| `summary.score_after` | ≥ 85 | overall audit score |
| `summary.readiness` | ≥ 80 | graph readiness |
| `graph.stats.isolate_ratio` | ≤ 0.25 | share of products with no edge |
| `summary.dropped` | 0 | identity/name failures |
| `summary.merged` | expected | duplicates collapsed |

Calibration point from the reference dataset (60 Shopee listings): score 79 → 92,
readiness 88, 129 nodes / 438 edges, 13 isolates out of 60. A run far below
these numbers means the input or the taxonomy regressed, not that scoring is strict.

If readiness is low, look at `readiness_breakdown` before touching anything:
`connectivity` and `attributes` carry the most weight (25% / 20%).

**5. Export or sync**

```bash
curl -o nodes.csv "http://localhost:3000/api/network/export?part=nodes&format=csv"
curl -o edges.json "http://localhost:3000/api/network/export?part=edges&format=json"
```

Parts: `nodes`, `edges`, `records`, `report`, `graph`. CSV is UTF-8 with BOM so
Thai survives Excel.

## Hard rules

- **Deterministic only.** No LLM/AI in taxonomy, normalization, dedupe or
  similarity. The same bytes must produce the same graph.
- **Identity first.** `ext = shopee:{shop_id}:{product_id}` is the join key
  everywhere. Records that cannot form it get dropped and reported.
- **Thai text order.** `repairMojibake` → `cleanProductName` → `stripPromo`.
  Cleaning a raw name before repair destroys the evidence.
- **Stable taxonomy ids.** Add keywords or aliases; never rename an id that
  snapshots and edges already reference. Unmatched types are `*_generic`.
- **Specific beats generic.** Longer keywords must outscore shorter ones so
  `โต๊ะคอมพิวเตอร์` wins over `โต๊ะ`.
- **Penalties are capped.** critical 45, warning 22, info 6 per finding; one
  problem never gets charged twice.

## Reading the result honestly

A high score with a bad graph is a failure. Always report the pair:
`score_after` (data quality) **and** `readiness` (can this be networked?), plus
`isolates` and `components`. A dataset of 60 products with 17 components is a
cluster problem, not a scoring problem.

When only one source is available, say which one: `source=file` has no images
and no `_raw`, so image/spec findings there are expected, not regressions.

## Examples

**Misclassification — table sold as food**

Symptom: `in_category` edges pile up under `food` for listings named
`โต๊ะวางอาหาร`. Cause: the keyword `วางอาหาร` matched the food list before the
furniture list. Fix: drop the generic food phrase, add `โต๊ะวางอาหาร` to the
furniture/table keywords, rebuild, then confirm the `product_type` histogram
shifts as expected.

**Mojibake rescue**

Symptom: names contain `à¸ªà¸´à¸™à¸„à¹‰à¸²`. Cause: UTF-8 bytes decoded as
windows-874. Fix: `repairMojibake` tries windows-874/UTF-8 round-trips and
records the repair in `repaired`; report the count instead of silently fixing.

**Choosing a dedupe mode**

`merge` (default) unions specs and keeps the max of sold/review counts.
`keep-richest` when one scrape is known to be better than the others.
`keep-first` only for append-only logs where order is meaningful.

## Verification before you report done

```bash
npx tsc --noEmit
curl -s "http://localhost:3000/api/network/audit?source=db" | head -c 200
```

Then load `http://localhost:3000/network`: the 5-step bar should render, step 2 shows the
score (before → after) and readiness, and step 4 shows nodes/edges plus the delta from the
previous run. Report numbers from a fresh build, not from memory.

## Additional resources

- Field-by-field data contract, node/edge semantics, thresholds and module map:
  see [reference.md](reference.md).
