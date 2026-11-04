/**
 * Trust Gate — ด่านก่อนสินค้าจะถูกจัดอันดับ/แนะนำ
 * ------------------------------------------------
 * ตรวจ 3 ชั้นตามเอกสาร: Identity → Availability → Trust Evidence
 * ผลลัพธ์: pass | review | blocked (deterministic, ประเมินใหม่ทุกรอบ)
 *
 * หมายเหตุ: `status` ของ admin (pending/approved/...) เป็นคนละชั้น — gate ไม่แตะ
 */
import type { GateCheck, GateResult, NormalizedProduct } from './types';

export const GATE_DEFAULTS = {
  maxAgeDays: 7,
  minQuality: 50,
} as const;

/** flag ที่กระทบความน่าเชื่อถือของหลักฐาน → review (ไม่ใช่ blocked) */
export const GATE_REVIEW_FLAGS = new Set([
  'encoding_repaired',
  'price_unparsed',
  'identity_healed',
  'platform_missing',
  'negative_sold',
  'currency_unsupported',
  'rating_out_of_range',
  'duplicate_name',
]);

export interface GateOptions {
  now?: Date;
  maxAgeDays?: number;
  minQuality?: number;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86400000;
}

export function evaluateGate(p: NormalizedProduct, opts: GateOptions = {}): GateResult {
  const now = opts.now ?? new Date();
  const maxAgeDays = opts.maxAgeDays ?? GATE_DEFAULTS.maxAgeDays;
  const minQuality = opts.minQuality ?? GATE_DEFAULTS.minQuality;

  const checks: GateCheck[] = [];
  const reasons: string[] = [];
  const add = (id: string, result: GateCheck['result'], detail?: string) => {
    checks.push({ id, result, detail });
    if (result !== 'pass') reasons.push(detail ? `${id}:${detail}` : id);
  };

  // ── Identity ──────────────────────────────────────────────
  if (!p.product_id || !p.shop_id) add('missing_identity', 'fail');
  else add('identity', 'pass');

  add('name', p.name && p.name.trim() ? 'pass' : 'fail', p.name ? undefined : 'empty_name');

  if (!(p.price > 0)) add('price_invalid', 'fail', 'price<=0');
  else add('price', 'pass');

  if (!/^https?:\/\//i.test(String(p.url ?? ''))) add('missing_url', 'warn');
  else add('url', 'pass');

  // ── Available ─────────────────────────────────────────────
  const unavailable =
    p.is_unavailable === true || (p.quality_flags ?? []).includes('unavailable');
  if (unavailable) add('unavailable', 'fail', 'datasource:is_unavailable');
  if (p.in_stock === false) add('out_of_stock', 'fail');
  else add('in_stock', 'pass');

  // ยอดขายเดือน > สะสม = ตัวเลข demand เชื่อถือไม่ได้จนกว่าจะ reconcile
  const soldInconsistent =
    (p.quality_flags ?? []).includes('sold_inconsistent') ||
    p.trust_risk?.sold.monthly_gt_historical === true;
  if (soldInconsistent) add('sold_inconsistent', 'fail', 'monthly_gt_historical');

  const ingested = p.ingested_at ? new Date(p.ingested_at) : null;
  if (!ingested || Number.isNaN(ingested.getTime())) {
    add('no_freshness_evidence', 'warn');
  } else {
    const age = daysBetween(ingested, now);
    if (age > maxAgeDays) add('stale_data', 'warn', `${Math.round(age)}d`);
    else add('freshness', 'pass');
  }

  // ── Trust evidence ────────────────────────────────────────
  const quality = Number(p.quality_score ?? 0);
  if (quality < minQuality) add('quality_below_min', 'fail', String(quality));
  else add('quality', 'pass');

  const flagged = (p.quality_flags ?? []).filter((f) => GATE_REVIEW_FLAGS.has(f));
  for (const flag of flagged) add('evidence_flagged', 'warn', flag);

  // ── Trust risk (รีวิว/นโยบายร้าน) ─────────────────────────
  const risk = p.trust_risk;
  if (risk?.policy.strict_return) {
    add('strict_return_policy', 'warn', 'ไม่รับเคลม/คืน/เปลี่ยนหลังยืนยัน');
  }
  if (
    risk?.flags.includes('severe_damage_cluster') &&
    !risk.policy.claim_support
  ) {
    add('review_damage', 'warn', `${risk.review.damage_mentions}/${risk.review.low_star} รีวิว 1–2 ดาว`);
  }

  const hasFail = checks.some((c) => c.result === 'fail');
  const hasWarn = checks.some((c) => c.result === 'warn');
  const status = hasFail ? 'blocked' : hasWarn ? 'review' : 'pass';

  return {
    status,
    reasons: [...new Set(reasons)],
    checks,
    risk_flags: risk?.flags ?? [],
    risk_level: risk?.level ?? null,
    checked_at: now.toISOString(),
  };
}

/** เติม p.gate ให้ทุกสินค้า — เรียกใน pipeline หลัง validate/enrichment */
export function attachGate(products: NormalizedProduct[], opts: GateOptions = {}): {
  pass: number;
  review: number;
  blocked: number;
} {
  const counts = { pass: 0, review: 0, blocked: 0 };
  const now = opts.now ?? new Date();
  for (const p of products) {
    try {
      const gate = evaluateGate(p, { now, ...opts });
      p.gate = gate;
      counts[gate.status] += 1;
    } catch {
      p.gate = null;
    }
  }
  return counts;
}
