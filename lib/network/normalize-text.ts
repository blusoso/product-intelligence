/**
 * Text normalization สำหรับ "ชั้น AI" — CHANGELOG v2 (2026-11-05):
 *  - normalizeForMatch: ลบ whitespace ทั้งหมด ก่อนเทียบ
 *  - bump version เป็น norm-v2
 */

import { normalizeWhitespace, stripHtml, stripInvisible, stripPromo } from './text';

export const TEXT_NORM_VERSION = 'norm-v2';

const UNIT_RULES: Array<[RegExp, string]> = [
  [/(\d)\s*ซ\.?\s*ม\.?/g, '$1cm'],
  [/(\d)\s*ม\.?\s*ม\.?/g, '$1mm'],
  [/(\d)\s*ก\.?\s*ก\.?/g, '$1kg'],
  [/(\d)\s*กรัม/g, '$1g'],
  [/(\d)\s*ลิตร/g, '$1l'],
  [/(\d)\s*วัตต์/g, '$1w'],
  [/(\d)\s*นิ้ว/g, '$1inch'],
  [/(\d)\s*cm\./gi, '$1cm'],
  [/(\d)\s*mm\./gi, '$1mm'],
  [/(\d)\s*kg\./gi, '$1kg'],
  [/(\d)\s*kgs?\./gi, '$1kg'],
];

const SMART_QUOTES: Array<[RegExp, string]> = [
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/\u2026/g, '...'],
];

export function normalizeForModel(input: unknown): string {
  let s = String(input ?? '');
  if (!s) return '';
  if (s.normalize) s = s.normalize('NFC');
  s = stripInvisible(s);
  s = stripHtml(s);
  s = stripPromo(s);
  for (const [re, replacement] of UNIT_RULES) {
    re.lastIndex = 0;
    s = s.replace(re, replacement);
  }
  for (const [re, replacement] of SMART_QUOTES) s = s.replace(re, replacement);
  return normalizeWhitespace(s);
}

/**
 * ใช้เทียบ/ทำกุญแจ — CHANGELOG v2:
 *  - ลบ whitespace ทั้งหมด + zero-width
 */
export function normalizeForMatch(input: unknown): string {
  return normalizeForModel(input)
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
}

export function findQuote(
  quote: string,
  normalizedText: string,
  rawText: string,
): 'normalized' | 'raw' | null {
  const q = normalizeForMatch(quote);
  if (q.length < 2) return null;
  if (normalizedText.includes(q)) return 'normalized';
  if (normalizeForMatch(rawText).includes(q)) return 'raw';
  return null;
}