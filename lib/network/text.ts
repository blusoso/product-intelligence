/**
 * Text / number utilities for messy marketplace data
 * --------------------------------------------------
 * ข้อมูล Shopee มาจาก HTML + emoji + คำโฆษณา + ตัวอักษรซ่อน
 * ฟังก์ชันในไฟล์นี้เป็น "deterministic" ทั้งหมด (ไม่มี AI) จึง audit ซ้ำได้ผลเดิม
 */

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const HTML_TAG = /<[^>]*>/g;
const HTML_TAG_TEST = /<[^>]*>/;
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu;

const THAI_DIGITS: Record<string, string> = {
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
  '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
};

/** คำโฆษณาที่ไม่สร้างความหมายให้ graph — ลบออกจากชื่อเพื่อจับคู่/จัดหมวด */
const PROMO_PATTERNS: RegExp[] = [
  /สินค้าพร้อมส่ง/g,
  /พร้อมส่ง/g,
  /ส่งฟรี/g,
  /ฟรีค่าส่ง/g,
  /ราคาถูก(ที่สุด)?/g,
  /ราคาโรงงาน/g,
  /ลดราคา(พิเศษ)?/g,
  /โปรโมชั่น(พิเศษ)?/g,
  /โปรแรง/g,
  /ของแท้(100%)?/g,
  /ของแท้จากต่างประเทศ/g,
  /รับประกัน(สินค้า)?/g,
  /ส่งไว/g,
  /จัดส่งไว/g,
  /มือหนึ่ง/g,
  /มือ1/g,
  /\bHOT\b/gi,
  /\bSALE\b/gi,
  /\bPROMO\b/gi,
  /\bBEST ?SELLER\b/gi,
  /\bREADY ?STOCK\b/gi,
  /\bFREE ?SHIP(PING)?\b/gi,
  /\bNEW\b/gi,
  /ถูกสุด/g,
  /คุ้มค่า/g,
  /ช้อปเลย/g,
  /สั่งเลย/g,
  /คลิกเลย/g,
];

/** อักขระที่โผล่เมื่อ UTF-8 ถูก decode ผิดเป็น windows-874/1252 */
const MOJIBAKE_MARK = /[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

let CP874_REVERSE: Map<string, number> | null = null;

function cp874Reverse(): Map<string, number> {
  if (CP874_REVERSE) return CP874_REVERSE;
  const dec = new TextDecoder('windows-874');
  const map = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    if (ch && ch !== '\uFFFD' && !map.has(ch)) map.set(ch, b);
  }
  CP874_REVERSE = map;
  return map;
}

export function looksMojibake(text: string): boolean {
  if (!text) return false;
  if (!MOJIBAKE_MARK.test(text)) return false;
  // ต้องมีอักษรไทยปนด้วย จึงจะถือว่าเป็นภาษาไทยที่ encode เพี้ยน
  return /[\u0E00-\u0E7F]/.test(text);
}

/**
 * ซ่อม mojibake แบบ UTF-8 → windows-874 (สาเหตุที่พบบ่อยในสคริปต์ scrape)
 * ใช้เฉพาะเมื่อ "ซ่อมแล้วดีขึ้นจริง" เท่านั้น ไม่เดา
 */
export function repairMojibake(text: string): string {
  if (!looksMojibake(text)) return text;
  const rev = cp874Reverse();
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const b = rev.get(ch);
    if (b == null) return text; // map ไม่ครบ → อย่าเสี่ยง
    bytes.push(b);
  }
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    if (!fixed || fixed === text) return text;
    const before = (text.match(MOJIBAKE_MARK) || []).length;
    const after = (fixed.match(MOJIBAKE_MARK) || []).length;
    if (after < before || (!after && /[\u0E00-\u0E7F]/.test(fixed))) return fixed;
    return text;
  } catch {
    return text;
  }
}

export function stripInvisible(text: string): string {
  return text.replace(ZERO_WIDTH, '');
}

export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(HTML_TAG, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function countEmoji(text: string): number {
  return (text.match(EMOJI) || []).length;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function stripPromo(text: string): string {
  let out = text;
  // วงเล็บ/วงเล็บเหลี่ยมที่บรรจุคำโฆษณา (【พร้อมส่ง】 ฯลฯ)
  out = out.replace(/[【\[（(][^】\]）)]*[】\]）)]/g, (m) => {
    const inner = m.slice(1, -1);
    const isPromo = PROMO_PATTERNS.some((re) => {
      re.lastIndex = 0;
      return re.test(inner);
    });
    return isPromo ? ' ' : m;
  });
  for (const re of PROMO_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, ' ');
  }
  out = out.replace(EMOJI, ' ');
  out = out.replace(/[!*~^_|]{2,}/g, ' ');
  out = out.replace(/\.{3,}/g, ' ');
  return normalizeWhitespace(out);
}

export interface CleanedText {
  text: string;
  repaired: string[];
  emoji: number;
  had_html: boolean;
  had_zero_width: boolean;
}

/** ทำความสะอาดชื่อสินค้าแบบหลายขั้น และรายงานว่าซ่อมอะไรไป */
export function cleanProductName(raw: string): CleanedText {
  const repaired: string[] = [];
  let text = String(raw ?? '');
  const fixed = repairMojibake(text);
  if (fixed !== text) {
    repaired.push('mojibake');
    text = fixed;
  }
  const hadHtml = HTML_TAG_TEST.test(text);
  if (hadHtml) {
    repaired.push('html');
    text = stripHtml(text);
  }
  const hadZero = ZERO_WIDTH.test(text);
  ZERO_WIDTH.lastIndex = 0;
  if (hadZero) {
    repaired.push('zero_width');
    text = stripInvisible(text);
  }
  if (text.normalize) {
    const nfc = text.normalize('NFC');
    if (nfc !== text) {
      repaired.push('nfc');
      text = nfc;
    }
  }
  const emoji = countEmoji(text);
  const noPromo = stripPromo(text);
  if (noPromo !== normalizeWhitespace(text)) {
    repaired.push('promo_noise');
    text = noPromo;
  }
  text = normalizeWhitespace(text);
  if (text.length > 300) {
    text = text.slice(0, 300).trim();
    repaired.push('truncate');
  }
  return {
    text,
    repaired,
    emoji,
    had_html: hadHtml,
    had_zero_width: hadZero,
  };
}

/** คำ (word tokens) สำหรับแสดงผล/ดีบัก — ภาษาไทยไม่มีช่องว่างจึงใช้ร่วมกับ shingles */
export function tokenize(text: string): string[] {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!norm) return [];
  const words = norm.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (const w of words) {
    if (w.length <= 1) continue;
    out.add(w);
    // ภาษาไทย: เพิ่ม bigram/trigram ของตัวอักษรเพื่อใช้เทียบความคล้าย
    if (/[\u0E00-\u0E7F]/.test(w)) {
      const chars = [...w];
      for (let i = 0; i < chars.length - 2; i++) {
        out.add(chars.slice(i, i + 3).join(''));
      }
    }
  }
  return [...out];
}

/** character shingles (ใช้ jaccard ระหว่างสินค้า) */
export function shingles(text: string, n = 3): Set<string> {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[\s\-_/.,()[\]{}]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const chars = [...norm];
  const out = new Set<string>();
  if (chars.length <= n) {
    if (chars.length) out.add(chars.join(''));
    return out;
  }
  for (let i = 0; i <= chars.length - n; i++) out.add(chars.slice(i, i + n).join(''));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** แปลงตัวเลขจาก string ที่อาจมี comma/หน่วย/ตัวอักษรไทย */
export function parseNumber(input: any): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d);
  s = s.replace(/,/g, '').replace(/฿/g, '').replace(/บาท/g, '').replace(/\s/g, '');
  s = s.replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function thaiDigitsToArabic(value: string): string {
  return String(value ?? '').replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d);
}

const CURRENCY_MARKS: Array<[RegExp, string]> = [
  [/(\$|usd|ดอลลาร์)/i, 'USD'],
  [/(€|eur|ยูโร)/i, 'EUR'],
  [/(£|gbp|ปอนด์สเตอร์ลิง)/i, 'GBP'],
  [/(¥|jpy|เยน)/i, 'JPY'],
  [/(฿|บาท|thb|baht)/i, 'THB'],
];

/** เดาสกุลเงินจากข้อความ — ค่าเริ่มต้น THB (ไม่แปลงอัตราแลกเปลี่ยน) */
export function detectCurrency(input: any): string {
  const s = thaiDigitsToArabic(String(input ?? ''));
  for (const [re, code] of CURRENCY_MARKS) if (re.test(s)) return code;
  return 'THB';
}

/** คำบอกจำนวนที่ต่อท้ายตัวเลข เช่น "1.2พัน" — ต้องแปลงก่อนตัดตัวอักษรทิ้ง */
const MONEY_MULTIPLIER: Array<[RegExp, number]> = [
  [/ล้าน\s*$/i, 1_000_000],
  [/แสน\s*$/i, 100_000],
  [/หมื่น\s*$/i, 10_000],
  [/พัน\s*$/i, 1_000],
  [/k\s*$/i, 1_000],
];

/**
 * แปลงข้อความจำนวนเงิน/จำนวนนับที่อาจมีคำบอกหลัก
 * - "1.2พัน" → 1200, "1.2k" → 1200, "฿1,290" → 1290, "๑,๒๐๐" → 1200
 * - ถ้าแปลงไม่ได้ → null (ให้ผู้เรียกติด flag เอง ไม่เดา)
 */
export function parseMoney(input: any): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input == null) return null;
  let s = thaiDigitsToArabic(String(input).trim());
  if (!s) return null;

  let multiplier = 1;
  for (const [re, m] of MONEY_MULTIPLIER) {
    if (re.test(s)) {
      multiplier = m;
      s = s.replace(re, ' ');
      break;
    }
  }

  s = s.replace(/,/g, '').replace(/฿/g, '').replace(/บาท/g, '').replace(/\s/g, '');
  s = s.replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * multiplier * 100) / 100;
}

/** จำนวนนับ (ยอดขาย/รีวิว) — ใช้กติกาเดียวกับเงินเพื่อรองรับ "1.2พัน" */
export function parseQuantity(input: any): number | null {
  return parseMoney(input);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

export function slugKey(prefix: string, ...parts: (string | number | null | undefined)[]): string {
  const body = parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(':')
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${prefix}:${body}`;
}

/** คีย์สำหรับเทียบชื่อซ้ำ (ตัดช่องว่าง/วรรคตอน/emoji) */
export function nameKey(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(EMOJI, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
