/**
 * Keyword registry / audit — ตรวจ "ทุกคำ" ในพจนานุกรมว่ามีบทบาทอะไร
 * ------------------------------------------------------------------
 * ทำไมต้องมี:
 *  - คำเดียวกันอาจถูกใช้ในหลาย attribute (เช่น "ทำงาน" อยู่ทั้ง use_case และ occasion)
 *  - คำที่เป็น product type ไม่ควรถูกใช้เป็น use_case/function/context
 *  - คำ SEO/โฆษณาไม่ควรอยู่ใน keyword ของ attribute ใดเลย
 *
 * ไฟล์นี้ไม่ได้เป็นแหล่ง keyword เอง (vocab.ts/taxonomy.ts ยังเป็นแหล่งจริง)
 * แต่สร้าง index จากของจริง + exception list เพื่อให้ script/test ตรวจได้ว่า
 * "ไม่มีคำไหนหลุดการรีวิว" และ "ไม่มี collision ที่ยังไม่อนุมัติ"
 */
import { ATTRIBUTES, type AttrId } from './vocab';
import { CATEGORIES, PRODUCT_TYPES } from './taxonomy';
import { SEO_TERMS, containsSeoTerm } from './seo-keywords';

export type KeywordRole =
  | 'use_case'
  | 'function'
  | 'context'
  | 'style'
  | 'space'
  | 'audience'
  | 'occasion'
  | 'adjustability'
  | 'power_source'
  | 'assembly'
  | 'finish'
  | 'visual'
  | 'product_type'
  | 'category'
  | 'material'
  | 'marketing'
  | 'generic'
  | 'ambiguous';

export type OwnerKind = 'attribute' | 'product_type' | 'category';

export interface KeywordOwner {
  kind: OwnerKind;
  role: KeywordRole;
  /** attribute id (เมื่อ kind='attribute') */
  attr?: AttrId;
  /** value id ของ attribute หรือ id ของ product type/category */
  value: string;
  label: string;
}

export interface KeywordEntry {
  term: string;
  owners: KeywordOwner[];
}

export interface KeywordIssue {
  kind: 'seo_in_keyword' | 'removed_keyword' | 'unapproved_overlap' | 'empty_term';
  term: string;
  detail: string;
}

const ATTR_ROLE: Record<AttrId, KeywordRole> = {
  use_case: 'use_case',
  function: 'function',
  context: 'context',
  style: 'style',
  space: 'space',
  audience: 'audience',
  occasion: 'occasion',
  adjustability: 'adjustability',
  power_source: 'power_source',
  assembly: 'assembly',
  finish: 'finish',
  visual_features: 'visual',
  material_visual: 'visual',
};

/**
 * คำที่ "ถอดออกจากทุกที่" แล้ว — ถ้ายังโผล่ใน vocab/taxonomy แปลว่ามีการใส่กลับ
 * (คำที่แค่ย้ายที่ เช่น home office → context ไม่ต้องอยู่ในนี้)
 */
export const REMOVED_KEYWORDS: Record<string, string> = {
  ที่วางหนังสือ: 'เป็น product type/ของวางหนังสือ ไม่ใช่ use case',
  'book stand': 'เป็น product type/ของวางหนังสือ ไม่ใช่ use case',
  ตั้งโต๊ะ: 'กำกวม (อาจหมายถึงตั้งบนโต๊ะหรือโต๊ะตั้ง)',
  'desk setup': 'เป็น product/context ไม่ใช่ use case',
  workstation: 'เป็น product/context ไม่ใช่ use case',
  ออนไลน์: 'เป็นช่องทาง ไม่ใช่ use case',
  zoom: 'เป็นแบรนด์/แพลตฟอร์ม',
  webcam: 'เป็นอุปกรณ์',
  ไมค์: 'เป็นอุปกรณ์',
  เกม: 'เป็นคำกว้าง ใช้ "เล่นเกม" แทน',
  cookware: 'เป็น product type',
  จานชาม: 'เป็น product type',
  ช้อนส้อม: 'เป็น product type',
  tableware: 'เป็น product type',
  สกินแคร์: 'เป็น product type',
  ครีมบำรุง: 'เป็น product type',
  ครีมทาหน้า: 'เป็น product type',
  เซรั่ม: 'เป็น product type',
  serum: 'เป็น product type',
  lotion: 'เป็น product type',
  moisturizer: 'เป็น product type',
  เครื่องสำอาง: 'เป็น product type',
  เมคอัพ: 'เป็น product type',
  cosmetic: 'เป็น product type',
  ไดร์เป่า: 'เป็น product type',
  แปรงสีฟัน: 'เป็น product type',
  โกน: 'สั้น/กำกวม ใช้ "โกนหนวด"',
  'hair dryer': 'เป็น product type',
  shaver: 'เป็น product type',
  gym: 'เป็นสถานที่/คำกว้าง',
  luggage: 'เป็น product type',
  organizer: 'เป็น function/คำกว้าง',
  ของแต่งบ้าน: 'เป็น product type',
  decor: 'เป็น product type/function',
  ornament: 'เป็น product type',
  ไม้ม็อบ: 'เป็น product type',
  mop: 'เป็น product type',
  'light': 'กว้าง/ชน light wood — ใช้ lamp',
  'desk': 'กว้าง/ชน desk lamp — ใช้ compound desk terms',
  'notebook': 'ชน laptop/stationery — เก็บไว้ที่ laptop เท่านั้น',
  'เคส': 'กว้าง — ใช้ เคสโทรศัพท์/phone case',
  'กาแฟ': 'กว้าง/ชน โต๊ะกาแฟ — ใช้คำเฉพาะ',
  'สีน้ำ': 'ชน สีน้ำตาล — ใช้ สีน้ำมัน/สีอะคริลิก',
  'ชุด': 'กว้าง/ชน ชุดโต๊ะ — ใช้ เสื้อผ้า',
  'จอ': 'สั้น/กำกวม — ใช้ จอคอม/มอนิเตอร์',
  'แป้ง': 'ชนแป้งทำอาหาร — ใช้ แป้งแต่งหน้า',
  'ประกอบ': 'กำกวม — ใช้ ประกอบเอง/ต้องประกอบ',
  'light bulb': 'เป็น product type',
  'task light': 'เป็น product type',
  'โคมไฟตั้งโต๊ะ': 'เป็น product type',
  'ไฟอ่านหนังสือ': 'เป็น product type',
  'ไฟประดับ': 'เป็น product type',
  'ไฟหัวเตียง': 'เป็น product type',
  'ไฟกลางคืน': 'เป็น product type',
  'โคมระย้า': 'เป็น product type',
  'ไฟเพดาน': 'เป็น product type',
  'ชั้นวาง': 'เป็น product type',
  ตู้: 'เป็น product type',
  กล่อง: 'เป็น product type',
  ตะกร้า: 'เป็น product type',
  เก้าอี้: 'เป็น product type',
  'เบาะนั่ง': 'เป็น product type',
  เคาน์เตอร์: 'เป็น product type/ส่วนประกอบ',
  ราง: 'เป็นส่วนประกอบ',
  ที่เก็บ: 'เป็นส่วนประกอบ',
  'ตัวแบ่ง': 'เป็นส่วนประกอบ',
  'ของตกแต่ง': 'เป็น product type',
  โมเดล: 'เป็น product type',
  แปรง: 'เป็น product type',
  น้ำยา: 'เป็น product type',
  'เครื่องโกน': 'เป็น product type',
  'แปรงแต่งหน้า': 'เป็น product type',
  ตาชั่ง: 'เป็น product type',
  ตลับเมตร: 'เป็น product type',
  'ขาตั้ง': 'เป็นส่วนประกอบ',
  ฐาน: 'เป็นส่วนประกอบ',
  'ขาโต๊ะ': 'เป็นส่วนประกอบ',
  'ที่ชาร์จ': 'เป็น product type',
  พัดลม: 'เป็น product type',
  หม้อ: 'เป็น product type',
  กระทะ: 'เป็น product type',
  หัวเตียง: 'เป็นส่วนประกอบ',
  'โต๊ะทำงาน': 'เป็น product type',
  'โต๊ะอ่านหนังสือ': 'เป็น product type',
  'โต๊ะเขียนหนังสือ': 'เป็น product type',
};

/**
 * คำที่ตั้งใจให้อยู่หลายที่ (ต้องมีเหตุผล) — ใช้เฉพาะกรณี attribute↔attribute
 * หรือ product_type↔product_type ที่ audit ไม่สามารถตัดสินแทนได้
 * (category↔type/category↔attribute ถือว่าเป็นชั้นหยาบ/ชั้นละเอียด จึงอนุญาตอัตโนมัติ)
 */
export const ALLOWED_OVERLAPS: Record<string, string> = {
  'ทำงาน': 'use_case desk_work + occasion work (AI-only); ไม่ชนใน rule',
  'เรียน': 'use_case study + occasion study (AI-only); ไม่ชนใน rule',
  'study': 'use_case study + occasion study (AI-only); ไม่ชนใน rule',
  'ออกกำลังกาย': 'use_case fitness + occasion exercise (AI-only); ไม่ชนใน rule',
  'ฟิตเนส': 'use_case fitness + product type fitness_equipment',
  'โยคะ': 'use_case fitness + product type fitness_equipment',
  'วิ่ง': 'use_case fitness + category sport',
  'เก็บของ': 'use_case organizing + function storage — คนละชั้น (ทำอะไร vs ทำหน้าที่)',
  'จัดเก็บ': 'use_case organizing + function storage',
  'จัดระเบียบ': 'use_case organizing + function organization',
  'ตกแต่ง': 'use_case decoration + function decoration_role',
  'ทำความสะอาด': 'use_case cleaning + function cleaning_role',
  'ปรุงอาหาร': 'use_case cooking + function cooking_role',
  'cleaning': 'use_case cleaning + function cleaning_role',
  'cooking': 'use_case cooking + function cooking_role',
  'decorating': 'use_case decoration + function decoration_role',
  'grooming': 'use_case grooming + function grooming_role',
  'ผิวด้าน': 'finish matte + vision-only material_visual matte_finish',
  'สไตล์': 'ไม่ควรเป็น keyword',
};

const termKey = (term: string) => String(term ?? '').trim().toLowerCase();

/** สร้าง index ของทุกคำจาก vocab/taxonomy จริง */
export function buildKeywordIndex(): Map<string, KeywordEntry> {
  const map = new Map<string, KeywordEntry>();
  const add = (term: string, owner: KeywordOwner) => {
    const key = termKey(term);
    if (!key) return;
    const entry = map.get(key);
    if (entry) {
      if (!entry.owners.some((o) => o.kind === owner.kind && o.attr === owner.attr && o.value === owner.value)) {
        entry.owners.push(owner);
      }
    } else {
      map.set(key, { term: String(term).trim(), owners: [owner] });
    }
  };

  for (const attr of ATTRIBUTES) {
    for (const value of attr.values) {
      const owner: KeywordOwner = {
        kind: 'attribute',
        role: ATTR_ROLE[attr.id],
        attr: attr.id,
        value: value.id,
        label: value.label,
      };
      for (const term of [...value.th, ...value.en]) add(term, owner);
    }
  }

  for (const type of PRODUCT_TYPES) {
    for (const term of type.keywords) {
      add(term, {
        kind: 'product_type',
        role: 'product_type',
        value: type.id,
        label: type.label,
      });
    }
  }

  for (const category of CATEGORIES) {
    for (const term of category.keywords) {
      add(term, {
        kind: 'category',
        role: 'category',
        value: category.id,
        label: category.label,
      });
    }
  }

  return map;
}

const SEO_KEYS = new Set(SEO_TERMS.map(termKey));
function overlapAllowed(term: string, owners: KeywordOwner[]): boolean {
  if (ALLOWED_OVERLAPS[term]) return true;
  const kinds = new Set(owners.map((o) => o.kind));
  // category เป็นชั้นหยาบ — อยู่ร่วมกับ type/attribute ได้
  if (kinds.size === 2 && kinds.has('category')) return true;
  return false;
}

/** ตรวจทั้งคลัง — คืน issues (ว่าง = ผ่าน) และ entries สำหรับพิมพ์รายงาน */
export function auditKeywords(): {
  entries: KeywordEntry[];
  issues: KeywordIssue[];
  counts: { terms: number; attributes: number; productTypes: number; categories: number };
} {
  const map = buildKeywordIndex();
  const entries = [...map.values()].sort((a, b) => a.term.localeCompare(b.term, 'th'));
  const issues: KeywordIssue[] = [];

  for (const entry of entries) {
    const term = termKey(entry.term);
    if (!term) {
      issues.push({ kind: 'empty_term', term: entry.term, detail: 'คำว่าง' });
      continue;
    }
    const attrOwners = entry.owners.filter((o) => o.kind === 'attribute');
    if (containsSeoTerm(entry.term) || SEO_KEYS.has(term)) {
      issues.push({
        kind: 'seo_in_keyword',
        term: entry.term,
        detail: `เป็นคำ SEO แต่ยังอยู่ใน ${entry.owners.map((o) => `${o.kind}:${o.value}`).join(', ')}`,
      });
    }
    if (attrOwners.length && (REMOVED_KEYWORDS[entry.term] || REMOVED_KEYWORDS[term])) {
      issues.push({
        kind: 'removed_keyword',
        term: entry.term,
        detail: `ถูกถอดจาก vocab แล้ว (${REMOVED_KEYWORDS[entry.term] ?? REMOVED_KEYWORDS[term]}) แต่ยังอยู่ใน ${attrOwners
          .map((o) => `${o.attr}:${o.value}`)
          .join(', ')}`,
      });
    }

    const uniqueAttrs = new Set(attrOwners.map((o) => `${o.attr}|${o.value}`));
    if (uniqueAttrs.size > 1 && !overlapAllowed(term, entry.owners)) {
      issues.push({
        kind: 'unapproved_overlap',
        term: entry.term,
        detail: `อยู่หลาย attribute: ${[...uniqueAttrs].join(', ')}`,
      });
    }

    const typeOwners = entry.owners.filter((o) => o.kind === 'product_type');
    const uniqueTypes = new Set(typeOwners.map((o) => o.value));
    if (uniqueTypes.size > 1 && !overlapAllowed(term, entry.owners)) {
      issues.push({
        kind: 'unapproved_overlap',
        term: entry.term,
        detail: `อยู่หลาย product type: ${[...uniqueTypes].join(', ')}`,
      });
    }
  }

  return {
    entries,
    issues,
    counts: {
      terms: entries.length,
      attributes: entries.reduce((n, e) => n + e.owners.filter((o) => o.kind === 'attribute').length, 0),
      productTypes: entries.reduce((n, e) => n + e.owners.filter((o) => o.kind === 'product_type').length, 0),
      categories: entries.reduce((n, e) => n + e.owners.filter((o) => o.kind === 'category').length, 0),
    },
  };
}
