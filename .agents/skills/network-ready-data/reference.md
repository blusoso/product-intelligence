# Reference — network-ready data

## Data contract (`NormalizedProduct`)

Every stage passes this shape. Add fields to `lib/network/types.ts` first.

| Group | Fields | Notes |
|---|---|---|
| Identity | `node_key`, `ext`, `product_id`, `shop_id`, `platform` | `node_key` = `product:{platform}:{shop_id}:{product_id}` (lowercased, spaces → `-`); heal from `_raw` if top-level ids are missing |
| Text | `name`, `name_raw`, `name_tokens`, `title_length`, `description` | `name_raw` keeps the pre-clean value for audit; `description` (≤4,000 chars) is verbatim marketplace text used as AI evidence and persisted in `products.description` |
| Taxonomy | `category`, `category_confidence`, `product_type`, `type_confidence`, `brand`, `brand_confidence` | confidence 0..1, drives edge weight |
| Place | `province`, `region` | 77 provinces; unknown is `ไม่ระบุ` |
| Commerce | `price`, `price_before_discount`, `discount_pct`, `currency`, `price_raw_text`, `price_source`, `monthly_sold`, `historical_sold`, `rating`, `review_count`, `trust_score`, `listing_age_days`, `in_stock`, `is_ad`, `shopee_verified`, `url`, `image` | `monthly_sold ≤ historical_sold` is enforced; money parsed by `parseMoney` (handles `1.2พัน`, `฿1,290`, Thai digits) |
| Dimensions | `width_cm`, `depth_cm`, `height_cm`, `size_label`, `size_source`, `size_confidence`, `size_options` | always converted to cm (`lib/network/dimensions.ts`); multiple sizes across variants → `size_label` stays `null` |
| Variants | `variants[]`, `variant_count`, `variant_price_min/max`, `variant_axes` | option-level price/stock/size, up to 200 per listing |
| Canonical | `canonical_id`, `canonical_confidence`, `canonical_evidence`, `listing_count`, `is_primary_listing` | grouping only — never merges rows |
| History | `price_history` (`observations`, `min`, `max`, `last_change_pct`, `last_observed_at`) | attached at build from `data/network/price-history.jsonl` |
| Structure | `specs`, `materials`, `colors`, `room`, `style`, `spec_count`, `option_count` | parsed spec pairs; `room`/`style` are shortcuts for `enrichment.contexts[0]` / `enrichment.styles[0]` |
| Enrichment | `enrichment.use_cases[]`, `functions[]`, `contexts[]`, `styles[]`, `spaces[]`, `audiences[]`, `target_contexts[]`, `price_segment` | each tag = `{ id, value, confidence, evidence[] }`; `price_segment` = `{ label, basis: market\|absolute\|unknown, percentile, sample, median }` |
| AI enrichment | `ai` (`AiEnrichment \| null`) = `{ tags[], meta{} }`; tag = `{ attribute, value_id, value, confidence, grounded, quote?, conflict? }` | **inferred only** — separate from `enrichment`; value ids come from `vocab.ts`; no numeric/measurement fields by construction; persisted in `products.ai_enrichment` |
| Quality | `quality_score` 0..100, `completeness` 0..1, `quality_flags`, `repaired` | flags include `identity_healed`, `platform_missing`, `encoding_repaired`, `price_invalid`, `price_unparsed`, `price_from_variant`, `currency_unsupported`, `discount_inconsistent`, `rating_out_of_range`, `negative_sold`, `sold_inconsistent`, `location_unknown`, `category_low_confidence`, `type_unknown`, `brand_missing`, `missing_image`, `missing_specs`, `size_missing`, `size_partial`, `size_unit_assumed`, `size_outlier`, `size_variant_multiple`, `stale_data`, `duplicate_name`, `enrichment_sparse`, `context_missing` |
| Features | `features.price_band`, `velocity_band`, `age_band`, `trust_band`, `gmv_monthly`, `sold_ratio` | convenience buckets, not stored in DB |

## Product Attributes (มาตรฐานเดียวกันทุกสินค้า)

`lib/network/attributes.ts` is the **single builder** used by UI/API/export/audit.
Every product returns the same 18 keys in the same order; a missing value is an
empty array, not a missing key.

| # | attribute | source |
|---|---|---|
| 1-4 | `category`, `product_type`, `brand`, `province` | evidence |
| 5-9 | `use_case`, `function`, `context`, `style`, `space` | evidence (+ ai when conflicting) |
| 10-15 | `audience`, `occasion`, `adjustability`, `power_source`, `assembly`, `finish` | audience = evidence (student/kids/baby) + ai; others = ai_inferred |
| 16-18 | `size`, `target_context`, `price_segment` | computed |

Value shape: `{ value_id, label, source, confidence, evidence[], grounded?, conflict?, ai_model? }`
where `source ∈ { evidence, computed, ai_inferred, manual }`. `status` per attribute is
`evidence | computed | ai | mixed | manual | none`.

`manual` = a value an admin fixed in the review workbench (Products → Attributes).
It is stored in `products.attribute_overrides` (JSONB, never recomputed) and **replaces**
every other source for that attribute; `ProductAttribute` then carries
`overridden: true` and `superseded: <n>` (how many auto values were replaced).

**Separation rules (hard):**
- AI values live only in `ai_enrichment` / `record.ai`; `apply.ts` never merges them into `enrichment`.
- When AI agrees with a rule value the AI copy is dropped; for complementary
  attributes (`use_case`, `function`, `context`, `space`, `audience`) a different AI
  value is kept as an additional value; only `style` and genuinely exclusive values
  get `conflict: true`.
- `visual_features`/`material_visual` are vision-only: text AI and Phrase Memory may
  not create them.
- SEO/marketing terms (`ญี่ปุ่น`, `มินิมอล`, `มูจิ`, `หรูหรา`, `พรีเมียม`) are not
  evidence for style/type; `โต๊ะญี่ปุ่น` is resolved by `detectTypeOverride()`.
- No AI field may hold measurements — enum-only output has no numeric slots.
- DB view `public.product_attributes` flattens manual/evidence/computed/ai rows with a `source` column (no data duplicated). It has `product_type/brand/province` but not `category` (products has no category column); API/export include `category` from in-memory records.

**Manual-edit guard.** Columns an admin edited are listed in `products.manual_edits`
(`{ name: { at, by } }`). `applyCoreFields()` reads that map and skips those columns,
so a later auto-run/graph/backfill cannot overwrite a human decision. `attribute_overrides`
is never written by the pipeline at all.

## Graph vocabulary

Node types: `product`, `variant`, `shop`, `brand`, `category`, `product_type`, `province`, `region`,
plus enrichment nodes `use_case`, `function`, `context`, `style`, `space`, `price_segment`
(on by default via `enrich_nodes`), plus `ai_attribute` for AI-inferred values
(off by default via `ai_nodes`; these nodes carry `evidence_level: 'ai_inferred'`).

| Edge | Direction | Weight | Meaning |
|---|---|---|---|
| `sold_by` | product → shop | 1 | listing belongs to a shop |
| `variant_of` | variant → product | 1 | SKU/option of a listing (only when `variant_nodes` is on) |
| `same_product_as` | product ↔ product | `canonical_confidence` | two listings of the same model (evidence-based) |
| `brand_of` | product → brand | `brand_confidence` | brand attribution strength |
| `in_category` | product → category | 1 | coarse shelf |
| `has_type` | product → product_type | `type_confidence` | fine-grained type |
| `located_in` | product → province | 1 | seller/product location |
| `shop_located_in` | shop → province | 1 | aggregated shop location |
| `part_of_region` | province → region | 1 | geo hierarchy |
| `subtype_of` | product_type → category | 1 | taxonomy hierarchy |
| `similar_to` | product ↔ product | Jaccard score | undirected, same/similar name |
| `substitute` | product ↔ product | Jaccard score | same type, compatible price, different shop |
| `complements` | product ↔ product | 0.35 + price compat | different types, same shop (cross-sell) |
| `used_for` | product → use_case | tag confidence | what the product is used for (อ่านหนังสือ, ทำงานโต๊ะ) |
| `has_function` | product → function | tag confidence | functional role (ให้แสงเฉพาะจุด, เก็บของ) |
| `fits_context` | product → context | tag confidence | where it is used (ห้องนอน, มุมทำงาน) |
| `has_style` | product → style | tag confidence | style (มินิมอล, โมเดิร์น, ลอฟท์) |
| `fits_space` | product → space | tag confidence | suitable space (พื้นที่จำกัด, ติดผนัง, พกพา) |
| `in_price_segment` | product → price_segment | 1 | market-relative price tier; `evidence` carries `basis`, `percentile`, `sample`, `median` |
| `ai_about` | product → ai_attribute | AI tag confidence | **inferred only**; `evidence` carries `attribute`, `value_id`, `grounded`, `conflict`, `quote` |

`target_contexts` (e.g. "ห้องนอน · พื้นที่จำกัด") are derived attributes, not nodes.

`similar_to` / `substitute` / `complements` are undirected (`directed: false`);
the rest are directed.

## Thresholds and defaults

`DEFAULT_CONFIG` in `lib/network/pipeline.ts`:

| Knob | Default | Effect |
|---|---|---|
| `dedupe` | `merge` | unions specs, keeps max sold/reviews |
| `drop_invalid_identity` | `true` | drops rows without `product_id` or `shop_id` |
| `build_similarity` | `true` | builds product ↔ product edges |
| `similarity_threshold` | 0.34 | Jaccard cut for `similar_to` |
| `max_neighbors` | 8 | caps degree per product |
| `max_pair_candidates` | 250 | candidate cap, prevents O(n²) blowup |
| `variant_nodes` | `false` | adds one `variant` node per SKU to the graph |
| `enrich_nodes` | `true` | adds use_case/function/context/style/space/price_segment nodes |
| `enrich_min_confidence` | 0.5 | minimum tag confidence to become a node/edge |
| `ai_enrich` | `true` (needs `AI_API_KEY`) | run AI attribute extraction during the auto pipeline |
| `ai_min_confidence` | 0.55 | minimum AI tag confidence; grounded tags get a lower bar |
| `ai_max_records_per_run` | 150 | cost cap: records sent to AI per run |
| `ai_nodes` | `false` | add `ai_attribute` nodes + `ai_about` edges |
| `build_graph` | `true` (forced `false` in auto run) | whether `runPipeline` builds a graph |
| `canonicalize` | `evidence` | `off` / `evidence` (links in graph) / `propose` (labels only) |
| `canonical_threshold` | 0.8 | minimum confidence before two listings share a `canonical_id` |

Readiness (`computeStats` in `lib/network/graph.ts`):

| Component | Weight | Formula |
|---|---|---|
| identity | 15% | products with valid identity |
| attributes | 20% | mean coverage of category/type/brand/province |
| connectivity | 25% | `1 - isolate_ratio` |
| redundancy | 15% | `min(1, avg_degree / 3)` |
| sample_size | 10% | `min(1, log10(n + 1) / 2)` |
| record_quality | 15% | mean `quality_score` / 100 |

Audit dimensions (`lib/network/audit.ts`): identity 20, completeness 15,
validity 15, consistency 10, text 10, uniqueness 10, network 20. The `network`
dimension equals readiness — findings there are structural advice, not extra
penalties. The `dimensions` section (ขนาด & ตัวเลือก) and the `enrichment` section
(Product Understanding incl. AI coverage/conflicts) carry weight 0: they report
parsing coverage without moving the score.
Finding penalties are capped at critical 45 / warning 22 / info 6.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER` | `deepseek` | `deepseek` / `openai` / `compatible` |
| `AI_API_KEY` | — | enables AI enrichment; absent = feature off (rule-only) |
| `AI_MODEL` | `deepseek-flash` | model id (`deepseek-v4-pro` for deeper/pricey) |
| `AI_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible base URL (`{base}/chat/completions`) |
| `AI_THINKING` | `disabled` | DeepSeek thinking mode; `enabled` = reasoning (slower, costlier, temperature ignored) |
| `AI_MAX_TOKENS` | `1500` | per-request output cap (JSON mode can truncate if too low) |
| `AI_BATCH_SIZE` | `10` | items per request |
| `AI_CONCURRENCY` | `3` | parallel requests (DeepSeek limit: flash 2,500 / v4-pro 500) |
| `AI_TIMEOUT_MS` | `30000` | per-request timeout |
| `AI_TEMPERATURE` | `0` | only applied in non-thinking mode |
| `AI_JSON_MODE` | `1` | `0` disables `response_format: json_object` |
| `AI_ENRICH` | — | `0` disables AI even when a key exists |
| `AUTO_PIPELINE` | — | `0` disables the background auto run after ingest |

**DeepSeek notes** (see [JSON Output](https://api-docs.deepseek.com/guides/json_mode/),
[Chat API](https://api-docs.deepseek.com/api/create-chat-completion),
[Rate limit](https://api-docs.deepseek.com/quick_start/rate_limit/)):
JSON mode requires the word “json” plus an example in the prompt; if the model answers
non-JSON the API replaces it with spaces, so blank `content` is retried. Thinking mode is
on by default and ignores `temperature` — the client disables it for extraction.
`GET /models` + `GET /user/balance` are used by `GET /api/network/ai/health`.

Setup order: ใส่ `AI_API_KEY` ใน `.env` → **restart dev server** → เปิด /network กด
“ทดสอบ AI” → กด “เติม AI” (หรือรอ ingest รอบถัดไป)

The auto run relies on Next's `after()` in a long-lived Node process (`next dev` /
`next start`); on serverless platforms the post-response work can be cut short.

## Auto pipeline (after ingestion, graph excluded)

`POST /api/ingest` schedules background work with Next's `after()`; the response returns
before it runs. The job (`lib/network/auto.ts`) does:

```
loadProducts('db') → runPipeline({build_graph:false}) → enrichWithAi()
→ audit re-run (so AI coverage is included) → appendPriceObservations + attachPriceHistory
→ applyCoreFields('db','both')  ← writes products incl. description/enrichment/ai_enrichment
→ saveAuditRun(kind:'auto') → data/network/auto-run.json + runs.jsonl
```

- No graph, no snapshot: `graph.json` only changes when the user presses **สร้างกราฟ** (step 4).
- Runs coalesce (2s settle) and never overlap; a trigger during a run queues one rerun.
- Disable: `AUTO_PIPELINE=0` or `{ auto: false }` in the ingest body.
- Status file is `data/network/auto-run.json` (`running`/`done`/`failed`, 10-min stale guard).
- Readiness in the auto report is an *estimate* (coverage-based, no connectivity).

## AI enrichment rules (hard constraints)

- Vocabulary is closed (`lib/network/vocab.ts`): AI may only return `value_id`s listed there.
  Prompt/schema has no field for numbers, so measurements cannot be invented.
- AI output goes to `ai` / `products.ai_enrichment` — **never** into `enrichment` or
  factual columns (`price`, `*_cm`, `sold`, `stock`, …). `apply.ts` only writes
  `ai_enrichment` when a value exists, so a disabled run never erases stored AI data.
- `grounded` = the quoted text exists verbatim in name/specs/options; otherwise it is
  marked as inference and needs higher confidence.
- If a rule tag exists for the same attribute: identical value → AI tag dropped.
  For complementary attributes (`use_case`, `function`, `context`, `space`, `audience`)
  a different AI value is kept as an additional value. Only `style` (and genuinely
  exclusive values) gets `conflict: true`; the rule value stays authoritative.
- No key / provider error / timeout → `ai = null` (or `meta.status='error'`), pipeline continues.
- Cache: `data/network/ai-cache.jsonl` keyed by `model + prompt_version + vocab_version +
  phrase_version + input hash`; bump `PROMPT_VERSION` in `lib/network/ai.ts` when changing
  prompt or vocabulary.
- Input sent to the model is limited to name/specs/options/category/type (no ids, no shop, no price).


## API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/network/audit?source=db\|file&preview=n&save=1` | GET | dry run **without graph** (fast); readiness is an estimate; `save=1` stores the audit |
| `/api/network/audit-runs?limit=&kind=&full=1` | GET | audit history from `network_audit_runs` (full=1 includes reports) |
| `/api/network/attributes?ext=&limit=` | GET | standardized 18-attribute set per product (source-tagged) |
| `/api/network/attributes/summary` | GET | per-attribute coverage: evidence vs AI vs computed |
| `/api/network/ai/health?dry=1` | GET | validates key/model via `/models` (+ `/user/balance`); `dry=1` returns the request preview |
| `/api/network/build` | POST | builds the graph + snapshot (the only manual step); stores audit kind `graph` |
| `/api/network/auto-run` | GET | auto-run status + last result + `ai {available,provider,model,missing,failed}` |
| `/api/network/auto-run` | POST | trigger auto run (`{wait:true}` to await the result) |
| `/api/network/enrich-ai` | POST | backfill `ai_enrichment` (`{limit, budget_ms, force}`) → returns `{processed, remaining, audit_id}`; `?stream=1` answers NDJSON `stage`/`progress`/`done`/`error` events that drive the UI progress bar |
| `/api/network/graph?node_type=&edge_type=&limit=` | GET | snapshot slice for UI/visualization |
| `/api/network/export?part=&format=` | GET | `nodes`, `edges`, `records`, `report`, `graph`, `attributes` × `json`, `csv`; without a graph, records/report/attributes still work (nodes/edges/graph → 409) |

### Review workbench (`/products`)

| Route | Method | Purpose |
|---|---|---|
| `/api/products?view=list&status=&q=&limit=&offset=` | GET | lean queue rows (no `reviews`/`options`), `badges {attributes_filled, ai_values, verified_values, overridden, missing_fields}` + `counts` per status. `view=full` returns the old `select *` shape |
| `/api/products/options` | GET | form choices: product types, brands, provinces, the 18 attribute defs, vocab values per attribute |
| `/api/products/:id` | GET | full row + 18 attributes + `counts` + `ai_meta`; `?include=raw` adds `raw_products.payload` |
| `/api/products/:id` | PUT | edit `name, sku, price, commission_per_unit, product_type, brand, province, description, status`; validates, writes `manual_edits` for changed keys, sets `status_changed_at` |
| `/api/products/:id/overrides` | PUT | `{attribute, values:[{value_id}], note?}` or `{attribute, clear:true}` — vocab-validated manual attribute value |
| `/api/products/:id/enrich-ai` | POST | re-run AI for one row (`runPipeline([row])` → `enrichWithAi` → `applyCoreFields`) |
| `/api/products/bulk-status` | POST | `{ids,status}` → one update for many rows |
| `/api/products/:id/status` | POST | single-row status change (existing) |

Build body: `{ source, apply, syncMode, dedupe, drop_invalid_identity,
build_similarity, similarity_threshold, max_neighbors, max_pair_candidates,
variant_nodes, canonicalize, canonical_threshold, enrich_nodes,
enrich_min_confidence, ai_enrich, ai_min_confidence, ai_max_records_per_run, ai_nodes }`.
Server clamps numbers before use. The auto run forces `build_graph:false`.
`NetworkRun.kind` is `auto` (background), `graph` (snapshot build) or `sync`.

Build response adds `history { prices_added, prices_error }` and
`snapshot_copy` (per-run file under `data/network/snapshots/`, last 10 kept).
`POST /api/ingest` returns `raw_history { appended, skipped, error? }` — payload
versions are appended to `data/network/raw-history.jsonl` only when the hash
changes (5 versions per `ext`).

Snapshot lives at `data/network/graph.json` (meta + graph + report + records +
dropped + merged + changes). It is generated, git-ignored, and safe to rebuild.

## Module map

| File | Responsibility |
|---|---|
| `lib/network/types.ts` | canonical types, node/edge enums |
| `lib/network/text.ts` | mojibake repair, promo strip, shingles, Jaccard, name keys |
| `lib/network/taxonomy.ts` | keyword-scored category/type/brand/province taxonomy (+ bed_desk type override) |
| `lib/network/seo-keywords.ts` | SEO/marketing blacklist, masking, affirmed-term helper |
| `lib/network/keyword-registry.ts` | role audit for every vocab/taxonomy keyword |
| `lib/network/normalize.ts` | raw → `NormalizedProduct`, flags, quality score |
| `lib/network/dimensions.ts` | size parsing + unit conversion to cm (deterministic) |
| `lib/network/vocab.ts` | **single** vocabulary: attribute ids + Thai labels + keyword lists shared by rule engine, AI prompt/schema, UI and export |
| `lib/network/enrich.ts` | rule-based enrichment + target context + market-relative price segment |
| `lib/network/validate-enrichment.ts` | Layer 3: sanitize AI, dedupe, hierarchy, require evidence |
| `lib/network/ai.ts` | provider-aware client (DeepSeek/OpenAI/compatible): JSON mode, thinking off, retry/backoff, usage+cost, cache, second pass |
| `lib/network/attributes.ts` | **single** Product Attributes builder (18 keys, `evidence/computed/ai_inferred`, coverage, long-format flatten) |
| `lib/network/audit-store.ts` | audit history in DB (`saveAuditRun`/`readAuditRuns`, prune 200) |
| `lib/network/auto.ts` | background auto run queue/coalesce, status file, AI backfill + `aiStatus`/`countMissingAi` |
| `lib/network/canonical.ts` | model-code/name+size grouping → `canonical_id`, `same_product_as` pairs |
| `lib/network/history.ts` | append-only raw/price history, snapshot copies |
| `lib/network/audit.ts` | 9-section audit (enrichment incl. AI, weight 0), score, grade, readiness |
| `lib/network/graph.ts` | node/edge construction (incl. enrichment + `ai_attribute`), candidates, stats, filtering |
| `lib/network/pipeline.ts` | dedupe → normalize → price segment → graph (optional) → reports |
| `lib/network/store.ts` | snapshot read/write (requires a graph) |
| `lib/network/apply.ts` | sync back to `products` by `ext` (core/normalized, concurrency 3, `ai_enrichment` only when present) |
| `supabase/migrations/20261103131500_dedupe_schema.sql` | drops duplicate/legacy columns + unused tables (applied) |
| `supabase/migrations/20261103132500_enrichment.sql` | `products.enrichment` JSONB + GIN index (applied) |
| `supabase/migrations/20261103135500_ai_enrichment.sql` | `products.ai_enrichment` JSONB + GIN index |
| `supabase/migrations/20261103142100_audit_and_attributes.sql` | `network_audit_runs` + view `network_audit_findings` + view `product_attributes` |
| `supabase/migrations/20261103143000_product_description.sql` | `products.description` (หลักฐานสำหรับ AI/backfill) |
| `lib/network/source.ts` | Supabase (`db`) or `data/products.json` (`file`) loader |
| `app/network/page.tsx` | UI: stepper 5 ขั้น (เลือกแหล่ง → ตรวจ → ตั้งค่า → สร้างกราฟ → นำไปใช้) |
| `components/network/*` | ชิ้นส่วน UI ของหน้านั้น (StepBar, ConfigPanel, GraphView, RunHistory, …) |
| `app/api/network/config` | อ่าน/บันทึกค่าตั้ง pipeline (`data/network/config.json`) |
| `app/api/network/runs` | ประวัติการรัน + delta (`data/network/runs.jsonl`, เก็บ 50 ล่าสุด) |
| `lib/network/config.ts` | clamp/merge ค่าตั้ง + preset (default/strict/loose) |
| `lib/network/persist.ts` | อ่าน/เขียน config และ runs |

Data source precedence: `{ ...raw_payload, ...row }` — the DB row wins over the
raw payload (fetched from `raw_products` by `ext`; `_raw` no longer lives in
`products`), so admin edits are never reverted by a stale scrape.

## Extending safely

- New taxonomy value: add keywords, keep the id, rebuild, compare the
  `product_type` histogram before/after.
- New enrichment value: edit `lib/network/vocab.ts` (id + Thai label + keywords).
  Never add a bare 1–2 syllable Thai keyword — use `BLOCKED_SUFFIX` in `enrich.ts`
  when the word is a prefix of a common unrelated word (e.g. `แต่งหน้า` vs
  `แต่งหน้าบ้าน`). Rebuild and check `enrichment` coverage + a few evidence strings.
- New AI attribute: add it to `vocab.ts` with `evidence_capable:false` unless the rule
  engine has an explicit extractor (like `audience` student/kids/baby); the prompt,
  schema validation, UI and export all read from that registry. Bump `PROMPT_VERSION`
  so the cache is invalidated. Never add numeric/measurement attributes — they must come
  from extraction, not inference.
- Price segment: `PRICE_SEGMENT_MIN_SAMPLE` (8) controls when a category switches
  from absolute thresholds to market quantiles; keep the `basis` field honest.
- New normalized field: `types.ts` → `normalize.ts` → edge or report consumer →
  migration column if it must persist.
- New edge type: add to `EdgeType`, emit with a stable id and `evidence`, then
  update `/api/network/graph` allow-list and the export columns.
