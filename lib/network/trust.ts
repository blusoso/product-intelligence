/**
 * Trust Risk — deterministic signals ที่ไม่ควรเชื่อ datasource blindly
 * ------------------------------------------------------------------
 * ตรวจ 3 กลุ่มจากข้อมูลดิบ:
 *  1) รีวิว 1–2 ดาวที่มีคำบ่งชี้ความเสียหาย/ชำรุด
 *  2) ข้อความ description ที่เป็นนโยบายไม่รับเคลม/คืน/เปลี่ยน
 *  3) ความพร้อมขาย + ความสอดคล้องของยอดขาย
 *
 * ข้อจำกัดที่ตั้งใจ:
 *  - ไม่เรียก LLM และไม่ให้คะแนนแบบ black box — ทุก flag มี quote/ตัวเลข
 *  - รีวิวที่ datasource ส่งมาอาจถูกสุ่มมาเฉพาะ 1–2 ดาว + 5 ดาว sample
 *    จึงใช้ share ของ "low-star sample" ไม่ใช่ share ของ review_count ทั้งหมด
 *  - trust_score / tier ของ datasource ไม่ถูกใช้ตัดสินความเสี่ยง
 */
import type { TrustRisk, TrustRiskFlag, TrustRiskLevel, TrustRiskQuote } from './types';

export const TRUST_RISK_RULES = {
  damage_min_mentions: 5,
  damage_min_share: 0.3,
  damage_medium_mentions: 3,
  quote_limit: 3,
  quote_max_chars: 240,
} as const;

const DAMAGE_TERMS = [
  'แตกหัก',
  'แตก',
  'หัก',
  'บุบ',
  'ชำรุด',
  'ชํารุด',
  'ร้าว',
  'ผุ',
  'ขึ้นสนิม',
  'เป็นสนิม',
  'สนิม',
  'น็อตหลุด',
  'น็อตขาด',
  'น็อตหาย',
  'น็อตไม่ครบ',
  'ขาดน็อต',
  'ขาดอะไหล่',
  'อะไหล่ไม่ครบ',
  'ชิ้นส่วนไม่ครบ',
  'ประกอบไม่ได้',
  'ใช้งานไม่ได้',
  'โก่ง',
  'บิ่น',
  'เสียหาย',
  'ไม่ครบ',
  'หลุด',
] as const;

const NEGATION_BEFORE = /(?:ไม่|ไม่มี|ไม่พบ|ไม่ได้|ปราศจาก|ไร้)\s*(?:มี)?\s*(?:รอย)?\s*$/;

/** ค้นวลี "ไม่รับเคลม/ไม่รับคืน/ไม่รับเปลี่ยน" ที่เกี่ยวกับสินค้า ไม่ใช่สี/ที่อยู่/ค่าส่ง */
const STRICT_POLICY_PATTERNS: RegExp[] = [
  /ไม่รับเคลม/g,
  /ไม่สามารถเคลม/g,
  /ไม่รับคืน(?!ค่าส่ง)/g,
  /ไม่รับเปลี่ยน(?!\s*(?:สี|ที่อยู่|เบอร์|ขนาด|รายการ|คำสั่งซื้อ|เอง))/g,
  /ขอสงวนสิทธิ์[^.\n]{0,50}(?:เคลม|คืน|เปลี่ยน|รับผิดชอบ)/g,
  /(?:หลัง(?:จาก)?(?:กด)?(?:ยืนยัน|รับสินค้า))[^.\n]{0,80}(?:ไม่|ไม่ได้|ขอสงวนสิทธิ์)[^.\n]{0,40}(?:เคลม|คืน|เปลี่ยน|รับผิดชอบ)/g,
  /(?:ไม่|ไม่ได้)[^.\n]{0,20}(?:รับผิดชอบ|เคลม|คืน)[^.\n]{0,40}(?:หลัง|ยืนยัน|รับสินค้า)/g,
];

const CLAIM_SUPPORT_PATTERNS: RegExp[] = [
  /รับเคลม/g,
  /เคลมได้/g,
  /สามารถเคลม/g,
  /เปลี่ยนใหม่/g,
  /เปลี่ยนสินค้าให้/g,
  /ส่งใหม่ให้/g,
  /รับผิดชอบ(?:ให้|สินค้า)/g,
  /คืนเงิน/g,
  /คืนสินค้า/g,
  /รับคืน/g,
  /ประกัน[^.\n]{0,30}(?:เดือน|ปี|วัน)/g,
];

const NEGATION_BEFORE_MATCH = /(?:ไม่|ไม่ได้|ไม่สามารถ|ไม่ได้รับ)\s*$/;

export interface TrustRiskInput {
  /** normalize ตรวจแล้วว่ายอดขายเดือน > สะสม (หรือ raw บอกมา) */
  sold_inconsistent?: boolean;
  monthly_gt_historical?: boolean;
}

function firstString(...values: any[]): string | null {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function cleanText(value: any): string {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNegated(text: string, index: number, term: string): boolean {
  // คำว่า "ไม่ครบ" เป็น negative อยู่แล้ว — ไม่ต้องกันซ้ำ
  if (term.startsWith('ไม่')) return false;
  const before = text.slice(Math.max(0, index - 24), index);
  return NEGATION_BEFORE.test(before);
}

/** คืนคำที่พบเฉพาะที่ไม่ได้ถูกปฏิเสธ เช่น "ไม่มีรอยแตก" ต้องไม่คืน "แตก" */
export function detectDamageTerms(text: string): string[] {
  const normalized = cleanText(text);
  if (!normalized) return [];
  const found: string[] = [];
  for (const term of DAMAGE_TERMS) {
    let from = 0;
    for (;;) {
      const index = normalized.indexOf(term, from);
      if (index < 0) break;
      if (!isNegated(normalized, index, term)) {
        found.push(term);
        break;
      }
      from = index + term.length;
    }
  }
  return [...new Set(found)];
}

function parseReviews(raw: any): any[] {
  const source = raw?.reviews;
  if (Array.isArray(source)) return source;
  if (typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function reviewRating(review: any): number | null {
  const n = Number(review?.rating_star ?? review?.rating ?? review?.star);
  return Number.isFinite(n) ? n : null;
}

function reviewComment(review: any): string {
  return cleanText(review?.comment ?? review?.content ?? review?.text);
}

function quoteSnippet(text: string, max = TRUST_RISK_RULES.quote_max_chars): string {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

function findEvidence(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match.index >= 0) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 100);
      return quoteSnippet(`${start > 0 ? '…' : ''}${text.slice(start, end)}`);
    }
  }
  return null;
}

function hasPositiveMatch(text: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 16), index);
      if (!NEGATION_BEFORE_MATCH.test(before)) return true;
    }
  }
  return false;
}

function distributionLowStarShare(raw: any): number | null {
  const dist = raw?.rating_dist;
  if (!dist || typeof dist !== 'object') return null;
  const total = Number(dist.total);
  if (!Number.isFinite(total) || total <= 0) return null;
  const low = Number(dist.s1 ?? 0) + Number(dist.s2 ?? 0);
  if (!Number.isFinite(low)) return null;
  return Math.round((low / total) * 1000) / 1000;
}

function isUnavailable(raw: any): boolean {
  const v = raw?.is_unavailable;
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * ประเมินความเสี่ยงจาก raw payload (หรือ DB row ที่ merge payload แล้ว)
 * pure function: ผลซ้ำได้ ไม่ขึ้นกับเวลา/สุ่ม
 */
export function deriveTrustRisk(raw: any, opts: TrustRiskInput = {}): TrustRisk {
  const description = cleanText(raw?.description);
  const reviews = parseReviews(raw);
  const seen = new Set<string>();
  let sampled = 0;
  let lowStar = 0;
  let damageMentions = 0;
  const quotes: TrustRiskQuote[] = [];

  for (const review of reviews) {
    const comment = reviewComment(review);
    if (comment.length < 4) continue;
    if (seen.has(comment)) continue;
    seen.add(comment);
    sampled += 1;

    const rating = reviewRating(review);
    if (rating == null || rating > 2) continue;
    lowStar += 1;

    const terms = detectDamageTerms(comment);
    if (terms.length === 0) continue;
    damageMentions += 1;
    if (quotes.length < TRUST_RISK_RULES.quote_limit) {
      quotes.push({ rating, comment: quoteSnippet(comment), terms });
    }
  }

  const damageShare = lowStar > 0 ? damageMentions / lowStar : 0;
  const severeDamage =
    damageMentions >= TRUST_RISK_RULES.damage_min_mentions &&
    damageShare >= TRUST_RISK_RULES.damage_min_share;

  const strictReturn = hasPositiveMatch(description, STRICT_POLICY_PATTERNS);
  const claimSupport = hasPositiveMatch(description, CLAIM_SUPPORT_PATTERNS);
  const unavailable = isUnavailable(raw);
  const soldInconsistent =
    opts.sold_inconsistent === true ||
    opts.monthly_gt_historical === true ||
    raw?.monthly_gt_historical === true ||
    raw?.monthly_gt_historical === 1;

  const flags: TrustRiskFlag[] = [];
  if (damageMentions > 0) flags.push('has_damage_complaints');
  if (severeDamage) flags.push('severe_damage_cluster');
  if (strictReturn) flags.push('strict_return_policy');
  if (unavailable) flags.push('unavailable');
  if (soldInconsistent) flags.push('sold_inconsistent');

  let level: TrustRiskLevel = 'low';
  if (unavailable || soldInconsistent || strictReturn) level = 'high';
  else if (
    severeDamage ||
    (damageMentions >= TRUST_RISK_RULES.damage_medium_mentions && !claimSupport)
  ) {
    level = 'medium';
  }

  const datasourceTier = firstString(raw?.tier, raw?.datasource_tier);
  const sellerFlag = firstString(raw?.seller_flag);

  return {
    level,
    flags,
    review: {
      sampled,
      low_star: lowStar,
      damage_mentions: damageMentions,
      damage_share_low_star: Math.round(damageShare * 1000) / 1000,
      quotes,
    },
    policy: {
      strict_return: strictReturn,
      claim_support: claimSupport,
      evidence:
        findEvidence(description, STRICT_POLICY_PATTERNS) ??
        findEvidence(description, CLAIM_SUPPORT_PATTERNS),
      source: description ? 'description' : 'none',
    },
    availability: {
      unavailable,
      in_stock: !unavailable && raw?.in_stock !== false,
    },
    sold: {
      monthly_gt_historical: soldInconsistent,
    },
    distribution: {
      low_star_share: distributionLowStarShare(raw),
    },
    datasource_tier: datasourceTier,
    seller_flag: sellerFlag,
  };
}
