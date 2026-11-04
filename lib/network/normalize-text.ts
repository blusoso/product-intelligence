/**
 * Text normalization สำหรับ "ชั้น AI" (deterministic + มีเวอร์ชัน)
 * ----------------------------------------------------------------
 * ทำไมต้องมี:
 *  - ข้อความ Shopee/TikTok มี emoji, คำโฆษณา, หน่วยไทย/อังกฤษปนกัน, เครื่องหมายคำพูดสวย
 *  - ถ้าส่งข้อความดิบให้โมเดล: เปลือง token และ quote ที่ได้จะจับคู่กับพจนานุกรมวลีไม่ตรง
 *  - ถ้าทำความสะอาด "คนละแบบ" ตอนส่งกับตอนตรวจ grounding → quote จะตรวจไม่ผ่าน
 *
 * กติกา:
 *  - ฟังก์ชันทั้งหมด pure (ไม่มี I/O, ไม่มี AI) → รันซ้ำได้ผลเดิม
 *  - ไม่แปลงตัวเลข/หน่วยเป็นค่าอื่น (ไม่คูณ/หาร) — แค่สะกดหน่วยให้เป็นมาตรฐาน
 *  - `normalizeForModel` คงตัวพิมพ์ไว้ (ให้ quote ที่เก็บดูเป็นธรรมชาติ)
 *  - `normalizeForMatch` = ตัวพิมพ์เล็ก ใช้เป็นกุญแจเทียบ/ตรวจ grounding เท่านั้น
 *  - เปลี่ยนกติกาเมื่อไรให้ bump TEXT_NORM_VERSION (มันถูกใส่ใน cache key)
 */
import { normalizeWhitespace, stripHtml, stripInvisible, stripPromo } from './text';

export const TEXT_NORM_VERSION = 'norm-v1';

/** หน่วยที่เขียนต่างกัน → สะกดมาตรฐานเดียว (ต้องมีตัวเลขนำหน้าเสมอ) */
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

/**
 * ทำความสะอาดข้อความสำหรับส่งให้โมเดล (คงตัวพิมพ์)
 * ลำดับ: NFC → อักขระซ่อน → HTML → emoji/คำโฆษณา → หน่วย → เครื่องหมายคำพูด → ช่องว่าง
 */
export function normalizeForModel(input: unknown): string {
  let s = String(input ?? '');
  if (!s) return '';
  if (s.normalize) s = s.normalize('NFC');
  s = stripInvisible(s);
  s = stripHtml(s);
  // stripPromo ลบ emoji + คำโฆษณา + วงเล็บที่เป็นโปรโมชันให้แล้ว
  s = stripPromo(s);
  for (const [re, replacement] of UNIT_RULES) {
    re.lastIndex = 0;
    s = s.replace(re, replacement);
  }
  for (const [re, replacement] of SMART_QUOTES) s = s.replace(re, replacement);
  return normalizeWhitespace(s);
}

/** ใช้เทียบ/ทำกุญแจ: ตัวพิมพ์เล็ก + ช่องว่างเดียว (ต้องเป็นตัวเดียวกับที่ใช้ตรวจ grounding) */
export function normalizeForMatch(input: unknown): string {
  return normalizeForModel(input).toLowerCase();
}

/**
 * ตรวจว่า quote ปรากฏจริงในข้อความ (ใช้ทั้งข้อความที่ normalize แล้วและต้นฉบับ)
 * คืน 'normalized' | 'raw' | null เพื่อให้ผู้เรียกเก็บหลักฐานได้ว่าตรงกับชั้นไหน
 */
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
