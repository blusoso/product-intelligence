/**
 * SEO / marketing keywords — แยก "คำโฆษณา" ออกจาก "attribute จริง"
 * -----------------------------------------------------------------
 * ทำไมต้องมี:
 *  - ชื่อสินค้า Shopee/TikTok ใช้คำอย่าง "ญี่ปุ่น", "เกาหลี", "มูจิ", "มินิมอล",
 *    "พรีเมียม" เป็น keyword SEO บ่อยมาก โดยที่สินค้าไม่ได้มีสไตล์/ประเภทนั้นจริง
 *  - ถ้าปล่อยให้คำเหล่านี้เป็นหลักฐาน: style/product_type จะเพี้ยน และ Phrase Memory
 *    จะจำวลีกว้าง ๆ ไปใช้กับสินค้าอื่นผิด ๆ
 *
 * กติกา:
 *  - คำ SEO ยังอยู่ในข้อความจริง (ใช้ grounding / type override ได้)
 *  - แต่ถูก "mask" ก่อนจับ dictionary ของ style และถูกปฏิเสธเป็นวลีหน่วยความจำ
 *  - ฟังก์ชันทั้งหมด pure + deterministic
 */

/** คำ/วลี SEO ที่ห้ามใช้เป็นหลักฐานของ style หรือ product_type */
export const SEO_TERMS = [
  'ญี่ปุ่น',
  'เกาหลี',
  'มูจิ',
  'มินิมอล',
  'มินิมัล',
  'หรูหรา',
  'พรีเมียม',
  'japanese',
  'korean',
  'muji',
  'minimal',
  'ins',
  'luxury',
  'premium',
] as const;

/** ค่า style ที่มาจากคำ SEO ได้ง่าย — ใช้ sanitize คำตอบ AI */
export const SEO_DERIVED_STYLE_VALUES = ['japanese', 'minimal', 'luxury'] as const;

/** คำที่บ่งชี้ว่าเป็นโต๊ะญี่ปุ่น/โต๊ะวางบนเตียง (ใช้ร่วมกับ type override) */
export const JP_TABLE_TERMS = ['โต๊ะญี่ปุ่น'] as const;

/** หลักฐานเชิงบริบทว่าเป็นโต๊ะวางบนเตียง (น้ำหนักแรง) */
export const BED_CONTEXT_TERMS = [
  'วางบนเตียง',
  'บนเตียง',
  'โต๊ะเตียง',
  'bed desk',
  'bed table',
  'lap desk',
] as const;

/** หลักฐานเชิงบริบทว่าเป็นโต๊ะนั่งพื้น/โต๊ะกาแฟ */
export const COFFEE_CONTEXT_TERMS = [
  'นั่งพื้น',
  'โต๊ะกลาง',
  'โซฟา',
  'โต๊ะกาแฟ',
  'coffee table',
] as const;

/** ฟีเจอร์ที่พบบ่อยในโต๊ะวางบนเตียง แต่ไม่ได้เจาะจงพอด้วยตัวเอง */
export const WEAK_BED_FEATURES = ['ปรับระดับ', 'ขาพับ', 'พับเก็บ', 'พับได้'] as const;

/**
 * คำปฏิเสธที่นำหน้าคำสำคัญ (ตรวจ 12 ตัวอักษรก่อนหน้า)
 * ยอมให้มีคำช่วย/กริยาสั้น ๆ คั่นได้ เช่น "ไม่สามารถพับได้", "ไม่วางบนเตียง"
 */
export const NEGATION_BEFORE = /(?:ไม่มี|ไม่ต้อง|ไม่ใช่|ไม่|without|no)\s*\S{0,8}$/i;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isAsciiTerm = (term: string): boolean => /^[a-z0-9 _-]+$/i.test(term);

/** สร้าง regex ของคำ SEO โดยคำอังกฤษต้องเป็นคำเต็ม (กัน "ins" ไปเจอ "inspiration") */
function termPattern(term: string, flags: string): RegExp {
  const escaped = escapeRegExp(term);
  return new RegExp(isAsciiTerm(term) ? `\\b${escaped}\\b` : escaped, flags);
}

/** มีคำ SEO อยู่ในข้อความหรือไม่ (คำอังกฤษต้องเป็นคำเต็ม) */
export function containsSeoTerm(text: unknown): boolean {
  const hay = String(text ?? '');
  if (!hay) return false;
  return SEO_TERMS.some((term) => termPattern(term, 'i').test(hay));
}

/**
 * คำนี้ปรากฏแบบ "บอกว่ามี" (ไม่ถูกปฏิเสธ) หรือไม่
 * ใช้ทั้งใน enrich (feature words) และ type override (โต๊ะญี่ปุ่นไม่ปรับระดับ)
 */
export function hasAffirmedTerm(text: unknown, term: string): boolean {
  const hay = String(text ?? '').toLowerCase();
  const needle = String(term ?? '').toLowerCase();
  if (!hay || !needle) return false;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) return false;
    const before = hay.slice(Math.max(0, idx - 12), idx);
    if (!NEGATION_BEFORE.test(before)) return true;
    from = idx + needle.length;
  }
}

/**
 * แทนคำ SEO ด้วยช่องว่าง — ใช้เฉพาะตอนจับ dictionary ของ style
 * (ข้อความจริงที่ใช้ grounding/type ต้องไม่ถูกแก้)
 */
export function maskSeoTerms(text: unknown): string {
  let out = String(text ?? '');
  if (!out) return '';
  for (const term of [...SEO_TERMS].sort((a, b) => b.length - a.length)) {
    out = out.replace(termPattern(term, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * วลีนี้ "กว้าง/เป็นคำโฆษณา" จนไม่ควรถูกจำใน Phrase Memory หรือไม่
 * - วลีที่มีคำ SEO ใด ๆ ถือว่าไม่ปลอดภัย เพราะความหมายขึ้นกับคำอื่นในสินค้า
 */
export function isSeoAmbiguousPhrase(phrase: unknown): boolean {
  const p = String(phrase ?? '').trim();
  if (!p) return false;
  return containsSeoTerm(p);
}
