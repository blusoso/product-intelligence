/**
 * ขนาด/มิติสินค้า — แปลง "120x60x75 ซม." / "W120 D60 H75" / "1200 มม." ให้เป็น ซม.
 * -------------------------------------------------------------------------
 * deterministic ล้วน: ไม่เดาจากภาพหรือ AI และไม่แปลงหน่วยถ้าไม่มั่นใจว่าเป็นหน่วยนั้น
 * ถ้าแปลงไม่ได้ → คืน null ให้ผู้เรียกติด flag เอง (ห้ามเดาค่า)
 */
import { thaiDigitsToArabic } from './text';

const NUM = '(\\d+(?:\\.\\d+)?)';
/** เรียงจากหน่วยที่ยาว/เฉพาะเจาะจงก่อน เพื่อไม่ให้ "มม" ถูกอ่านเป็น "ม" */
const UNIT = '(?:เซนติเมตร|ซม\\.?|cm\\.?|มิลลิเมตร|มม\\.?|mm|นิ้ว|inch|in|เมตร|ม\\.|m)';

const LABELED = new RegExp(
  `(?:^|[^a-z])w\\s*[:=]?\\s*${NUM}\\s*(${UNIT})?[^\\d]{0,10}d\\s*[:=]?\\s*${NUM}\\s*(${UNIT})?[^\\d]{0,10}h\\s*[:=]?\\s*${NUM}\\s*(${UNIT})?`,
  'i',
);

const RUN = new RegExp(
  `${NUM}\\s*(${UNIT})?\\s*[x×*]\\s*${NUM}\\s*(${UNIT})?(?:\\s*[x×*]\\s*${NUM}\\s*(${UNIT})?)?`,
  'i',
);

export interface SizeParse {
  width_cm: number;
  depth_cm: number | null;
  height_cm: number | null;
  /** หน่วยที่เจอในข้อความ ('' = ไม่ระบุ) */
  unit: string;
  unit_assumed: boolean;
  outlier: boolean;
  dimensions: number;
  /** ลายนิ้วมือสำหรับจับคู่สินค้ารุ่นเดียวกัน เช่น 120x60x75 */
  signature: string;
  label: string;
  raw: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function toCm(value: number, unit?: string): number {
  const u = String(unit ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  if (u === 'มม' || u === 'มิลลิเมตร' || u === 'mm') return value / 10;
  if (u === 'เมตร' || u === 'ม' || u === 'm') return value * 100;
  if (u === 'นิ้ว' || u === 'inch' || u === 'in') return value * 2.54;
  return value;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round1(n));
}

function canonicalUnit(unit?: string): string {
  const u = String(unit ?? '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  if (u === 'ซม' || u === 'เซนติเมตร' || u === 'cm') return 'ซม.';
  if (u === 'มม' || u === 'มิลลิเมตร' || u === 'mm') return 'มม.';
  if (u === 'ม' || u === 'เมตร' || u === 'm') return 'ม.';
  if (u === 'นิ้ว' || u === 'inch' || u === 'in') return 'นิ้ว';
  return unit ? String(unit).replace(/\./g, '').trim() : '';
}

/**
 * อ่านขนาดจากข้อความ
 * - รองรับ 2 หรือ 3 มิติ, ทศนิยม, เลขไทย, หน่วยไทย/อังกฤษ, ป้าย W/D/H, กว้าง/ลึก/สูง
 * - ขนาดที่หลุดช่วง 5–500 ซม. ถือว่าน่าสงสัย (outlier) ไม่ใช้ต่อ
 */
export function parseSize(input: any): SizeParse | null {
  if (input == null) return null;
  let text = thaiDigitsToArabic(String(input)).trim();
  if (!text) return null;
  if (!/\d/.test(text)) return null;

  const original = String(input);
  text = text
    .replace(/กว้าง/gi, ' w ')
    .replace(/ลึก|หนา/gi, ' d ')
    .replace(/สูง/gi, ' h ')
    .replace(/[xX×＊*]/g, 'x');

  let m = LABELED.exec(text);
  let nums: Array<{ n: number; unit?: string }> | null = null;

  if (m) {
    nums = [
      { n: Number(m[1]), unit: m[2] },
      { n: Number(m[3]), unit: m[4] },
      { n: Number(m[5]), unit: m[6] },
    ];
  } else {
    m = RUN.exec(text);
    if (m) {
      nums = [
        { n: Number(m[1]), unit: m[2] },
        { n: Number(m[3]), unit: m[4] },
      ];
      if (m[5] != null) nums.push({ n: Number(m[5]), unit: m[6] });
    }
  }

  if (!nums || nums.length < 2) return null;

  const unit = nums.map((v) => v.unit).find((u) => u != null && String(u).trim() !== '') ?? '';
  const values = nums.map((v) => round1(toCm(v.n, v.unit ?? unit)));

  const outlier = values.some((v) => v < 5 || v > 500);
  const [w, d, h] = values;

  return {
    width_cm: w,
    depth_cm: d ?? null,
    height_cm: h ?? null,
    unit: canonicalUnit(unit),
    unit_assumed: !unit,
    outlier,
    dimensions: values.length,
    signature: values.map(fmt).join('x'),
    /** ค่าถูกแปลงเป็น ซม. แล้วเสมอ — หน่วยเดิมอยู่ใน unit */
    label: `${values.map(fmt).join('×')} ซม.`,
    raw: original,
  };
}

const SIZE_SPEC_NAME = /ขนาด|size|dimension|มิติ|กว้าง|ลึก|สูง|width|depth|height/i;

export type SizeSource = 'spec' | 'option' | 'title';

export interface SizeDetection {
  size: SizeParse | null;
  source: SizeSource | null;
  confidence: number;
  /** ตัวเลือก (variant) มีขนาดต่างกันหลายแบบ — ไม่ควรใช้ขนาดเดียวแทนทั้งสินค้า */
  variable: boolean;
  /** ขนาดที่พบในตัวเลือก (ใช้แสดงผล/ให้คนตัดสิน) */
  options: string[];
  outlier: boolean;
}

const SOURCE_BASE: Record<SizeSource, number> = { spec: 0.9, option: 0.85, title: 0.5 };

function confidenceFor(size: SizeParse, source: SizeSource): number {
  let c = SOURCE_BASE[source];
  if (size.unit_assumed) c -= 0.15;
  if (size.dimensions < 3) c -= 0.1;
  return Math.max(0.2, Math.round(c * 100) / 100);
}

function unique(values: string[], limit = 20): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * หาขนาดของสินค้า ตามลำดับ: สเปก → ตัวเลือก (option) → ชื่อสินค้า
 * ถ้าตัวเลือกมีหลายขนาด จะไม่สรุปเป็นขนาดเดียว (variable = true)
 */
export function detectSize(raw: any): SizeDetection {
  const empty: SizeDetection = {
    size: null,
    source: null,
    confidence: 0,
    variable: false,
    options: [],
    outlier: false,
  };

  const specs = Array.isArray(raw?.specs) ? raw.specs : [];
  for (const s of specs) {
    const name = String(s?.name ?? '');
    if (!SIZE_SPEC_NAME.test(name)) continue;
    const size = parseSize(s?.value);
    if (!size) continue;
    if (size.outlier) return { ...empty, source: 'spec', outlier: true };
    return { ...empty, size, source: 'spec', confidence: confidenceFor(size, 'spec') };
  }

  const optionSizes: SizeParse[] = [];
  for (const o of Array.isArray(raw?.options) ? raw.options : []) {
    const size = parseSize(o?.name);
    if (size && !size.outlier) optionSizes.push(size);
  }
  if (optionSizes.length) {
    const labels = unique(optionSizes.map((s) => s.label));
    if (labels.length > 1) {
      return { ...empty, source: 'option', variable: true, options: labels };
    }
    const size = optionSizes[0];
    return {
      ...empty,
      size,
      source: 'option',
      confidence: confidenceFor(size, 'option'),
      options: labels,
    };
  }

  const title = parseSize(raw?.name ?? raw?.product_name ?? raw?.title);
  if (title) {
    if (title.outlier) return { ...empty, source: 'title', outlier: true };
    return { ...empty, size: title, source: 'title', confidence: confidenceFor(title, 'title') };
  }

  return empty;
}
