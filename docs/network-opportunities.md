# Network Opportunities — Proven / Hidden / Emerging

เอกสารนี้อธิบายกติกาที่ระบบใช้สร้าง graph, Trust Gate และจัดประเภทโอกาส
ทั้งหมดเป็น **deterministic** (ไม่มี LLM ในขั้นนี้) เพื่อให้ผลซ้ำได้และตรวจย้อนกลับได้

## 1. Edge ที่ใช้ (product ↔ product)

| Edge | เงื่อนไข | น้ำหนัก |
|---|---|---|
| `similar_to` | ประเภทเดียวกัน + attribute overlap ≥ `attribute_overlap_min` (default 0.50) + ไม่ใช่คู่ทดแทน | `(0.45×overlap + 0.30×shingle + 0.25×priceCompat) × trustFactor` |
| `substitute` | ประเภทเดียวกัน + overlap ≥ เกณฑ์ + ราคาต่างกันไม่เกิน 20% + คนละร้าน | เหมือน similar_to |
| `complements` | ต่างประเภท + มี use case ร่วม (conf ≥ 0.60) + ราคาไม่ต่างเกิน 20 เท่า | `conf × 0.6 × (0.8+0.2×priceCompat) × trustFactor` |
| `same_context` | ต่างประเภท + มี context/space ร่วม + ไม่มี use case ร่วม | `mean(conf) × 0.5 × trustFactor` |
| `used_with` | มี context/use case ร่วม + พบวลี "ซื้อคู่/ใช้คู่กับ/พร้อมกัน/จัดชุด/เป็นเซ็ต" ในชื่อหรือคำอธิบาย | `min(1, 0.5 + 0.3×conf + 0.2×trustFactor)` |

- `trustFactor = 0.6 + 0.4 × min(quality_scoreA, quality_scoreB)/100` (ฝั่งที่อ่อนกว่าคุม)
- คู่ที่ไม่มี context/use case ร่วมแต่ประเภทเดียวกัน ยังสร้าง `similar_to` ได้ ด้วยหลักฐาน
  `shared_basis = "shared_category"` + `evidence_gap = true` และน้ำหนัก ×0.85
- `used_with` ไม่ถูกสร้างจากการคาดเดา: ถ้าไม่มีวลีในข้อความจริง จะได้ 0 edge
  (ตัดคำว่า "พร้อม"/"แถม"/"เซ็ต" เดี่ยว ๆ ออก เพราะบน Shopee มักแปลว่า "พร้อมส่ง"/"แถมฟรี")

## 2. Trust Gate

ประเมินใหม่ทุกรอบ pipeline (ทั้ง auto-run และ build graph)

| Check | เงื่อนไข | ผล |
|---|---|---|
| identity | ไม่มี `product_id`/`shop_id` | Blocked |
| name | ชื่อว่าง | Blocked |
| price | `price <= 0` | Blocked |
| quality | `quality_score < 50` | Blocked |
| availability | `in_stock = false` | Blocked |
| availability | `is_unavailable = true` จาก datasource | Blocked (`unavailable`) |
| sold consistency | `monthly_gt_historical = true` หรือยอดขายเดือน > สะสม | Blocked (`sold_inconsistent`) |
| freshness | `ingested_at` เก่ากว่า `gate_max_age_days` (7) | Review (`stale_data`) |
| freshness | ไม่มี `ingested_at` | Review (`no_freshness_evidence`) |
| url | ไม่ใช่ http(s) | Review (`missing_url`) |
| evidence flags | `encoding_repaired`, `price_unparsed`, `identity_healed`, `platform_missing`, `negative_sold`, `currency_unsupported`, `rating_out_of_range`, `duplicate_name` | Review (`evidence_flagged:<flag>`) |
| seller policy | `description` มีนโยบายไม่รับเคลม/คืน/เปลี่ยนหลังยืนยัน | Review (`strict_return_policy`) |
| review risk | มี `severe_damage_cluster` และร้านไม่มีข้อมูลรับเคลม | Review (`review_damage`) |
| อื่น ๆ | — | Pass (อาจมี risk flags ระดับกลาง/ต่ำ) |

### 2.1 Trust Risk (deterministic)

คำนวณใน `lib/network/trust.ts` จากข้อมูลดิบ:

- รีวิว 1–2 ดาวเท่านั้น (ใช้ `rating_star`)
- คำเสียหาย: แตก/หัก/บุบ/ชำรุด/ร้าว/ผุ/สนิม/น็อตหลุด/อะไหล่ไม่ครบ/ประกอบไม่ได้ ฯลฯ
- negation guard: `ไม่มีรอยแตก`, `ไม่พบสนิม` ไม่ถูกนับ
- `severe_damage_cluster` = `damage_mentions ≥ 5` และ share ของ low-star sample `≥ 0.30`
- `strict_return_policy` = พบวลีไม่รับเคลม/คืน/เปลี่ยน **หลังยืนยันรับสินค้า**
  (ไม่รวม `ไม่รับเปลี่ยนสี/ที่อยู่/เบอร์` และ `ไม่รับผิดชอบค่าขนส่ง`)
- `claim_support` = พบ `รับเคลม`, `เปลี่ยนใหม่`, `ประกัน 1 ปี` ฯลฯ

> ใช้ share ของ **รีวิว 1–2 ดาวที่ถูกสุ่มมา** ไม่ใช่ `review_count` ทั้งหมด
> เพราะ datasource มักสุ่มรีวิว Coming 1–2 ดาวมาโดยเฉพาะ

Risk level:

| ระดับ | เงื่อนไข |
|---|---|
| `high` | unavailable / sold inconsistent / strict return policy |
| `medium` | severe damage cluster หรือ damage ≥ 3 ครั้งและไม่มี claim support |
| `low` | นอกเหนือจากนั้น |

`trust_score` และ `tier` จาก datasource **ไม่ถูกใช้ตัดสิน risk** — เป็น popularity signal เท่านั้น

flag ที่แปลว่า "ข้อมูลยังไม่ครบ" เช่น `brand_missing`, `size_missing`, `context_missing`
**ไม่** ทำให้เป็น Review (ถ้าทำจะเหลือ Pass แทบไม่มี)

`products.gate_status / gate_reasons / gate_checked_at` ถูก sync กลับ DB
(status ของ admin เช่น pending/approved เป็นคนละชั้น ไม่ถูกแตะ)

## 3. Proven / Hidden / Emerging

คำนวณใน `lib/network/opportunity.ts` หลังสร้าง graph:

- `degree` = จำนวน edge (similar/substitute/complements/same_context/used_with)
- `strength` = ผลรวมน้ำหนัก
- `pagerank` = power iteration บนกราฟ undirected (damping 0.85, 30 รอบ)
- percentile: `(#ค่า < x) / (n-1)`
- `demand[tag]` = ผลรวม `historical_sold` ของสินค้าที่ gate = pass และมีแท็กนั้น
  (`demand_share = demand / max(demand)`)

| ชั้น | เงื่อนไข | score |
|---|---|---|
| **Emerging** | `listing_age_days < 30`, ยอดขายเร่งตัว (`velocity = Fast` หรือ monthly/historical ≥ 0.5), `review_count < 50`, risk ไม่ใช่ high, gate ไม่ blocked | `0.6×demand_pct + 0.4×(1-age/30)` |
| **Proven** | gate = pass, อายุ ≥ 30 หรือไม่ทราบอายุ, `sold_pct ≥ 0.60`, `degree_pct ≥ 0.60` | `0.5×sold_pct + 0.3×degree_pct + 0.2×rating/5` |
| **Hidden** | gate = pass, อายุ ≥ 30 หรือไม่ทราบอายุ, ไม่ใช่ Proven, `audience_fit ≥ 0.55`, `degree_pct ≤ 0.50`, `rating ≥ 4.5`, `sold_pct < 0.60` | `0.5×fit + 0.3×(1-degree_pct) + 0.2×rating/5` |

**Lifecycle-first:** สินค้าอายุ < 30 วันจะไม่ถูกจัดเป็น Proven/Hidden แม้ยอดขายจะสูง
ถ้าไม่เข้าเงื่อนไข Emerging จะไม่ถูกจัดอันดับในรอบนั้น

**Risk penalty:** `medium` ลด score 0.05, `high` ลด 0.15 (โดยปกติ gate จะเป็น review/blocked อยู่แล้ว)

Audience Fit (ยังไม่มีข้อมูล Creator ในระบบ):
- มีแท็ก `audience` → `max(conf × demand_share)` → `basis = audience`
- ไม่มี → `max(conf × demand_share ของ context/use case) × 0.75` → `basis = context_fallback`

### Datasource tier vs Internal tier

- `datasource_tier` = `products.tier` เช่น `PROVEN`/`GEM` — popularity tier จาก Shopee ใช้แสดงผลเท่านั้น
- `internal_tier` = `opportunity_class` (`proven`/`hidden`/`emerging`) — คำนวณจาก graph + demand + audience fit + trust
- API/UI ส่งทั้งสองค่าแยกกัน; ไม่มี tier ใดถูกใช้แทนกัน

## 4. ทำไมต้องมี empty state

บางชั้นอาจว่างโดยชอบธรรม เช่น
- ยังไม่มีสินค้าอายุ < 30 วัน + ยอดขายเร่งตัว → Emerging = 0
- ยังไม่มีวลี "ใช้ด้วยกัน" → used_with = 0
- ยังไม่มีแถวที่ติด flag เชิงหลักฐาน → gate review = 0
- ยังไม่มีข้อมูลรีวิวในแถวที่โหลดมา → ประเมิน review risk ไม่ได้ (ไม่แปลว่าไม่มีความเสี่ยง)

หน้า `/opportunities` แสดง `diagnostics.note` + `review_coverage` +
`risk_counts` อธิบายเหตุผลแทนการผ่อนเกณฑ์เพื่อให้มีของ

## 5. การปรับค่า

หน้า Network → ขั้น 3 ตั้งค่าได้ 3 ค่า:

- `edge_min_confidence` (default 0.60) — rule tag จากชื่อได้ 0.60; ถ้าตั้ง 0.70 ตามเอกสาร
  ตรง ๆ ข้อมูล 61 สินค้าปัจจุบันจะเหลือ context เพียง 4 รายการ → ใช้ preset "เข้ม" (0.75) เมื่อข้อมูลหนาพอ
- `attribute_overlap_min` (default 0.50) — tag เฉลี่ยต่อสินค้า ~1.5 ค่า การตั้ง 0.70 จะตัดคู่ที่ควรจับเกือบทั้งหมด
- `gate_max_age_days` (default 7)
- risk thresholds อยู่ใน `TRUST_RISK_RULES` (`lib/network/trust.ts`): damage ≥ 5 ครั้ง,
  share ≥ 0.30, medium ที่ ≥ 3 ครั้ง — แสดงใน `diagnostics.thresholds` เพื่อตรวจย้อน

## 6. ที่เก็บผล

- snapshot: `data/network/graph.json` (`opportunities`, `diagnostics`, records มี `gate`/`trust_risk`/`opportunity`)
- API: `GET /api/network/opportunities`, `POST /api/network/sync-graph`
- export: `/api/network/export?part=opportunities&format=csv|json` (มี `datasource_tier`,
  `internal_tier`, `risk_level`, `risk_flags`, `risk`)
- DB: `products.gate_*`, `products.opportunity_*`, `products.risk_*`, `products.first_seen_at`,
  และ `network_runs/network_nodes/network_edges` (เก็บชุดล่าสุดชุดเดียว)
- migration: `20261104130000_trust_risk.sql`
