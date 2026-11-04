/**
 * Heuristics — กฎเพิ่มเติมแบบ deterministic สำหรับแถวที่ "พจนานุกรมคำ" ไม่พอ
 * ----------------------------------------------------------------------
 * ทำไมต้องมี:
 *  - ถ้าเรา gate ไม่ให้เรียก AI กับแถวที่กฎเข้าใจอยู่แล้ว แถวนั้นจะไม่มีข้อมูลเพิ่มเลย
 *  - ชนิดสินค้า (product_type) ถูกจำแนกมาจากข้อความอยู่แล้ว → ใช้ต่อยอดได้ถูกกฎหมาย
 *    (หลักฐานยังตรวจย้อนได้: "หมวด/ชนิด: desk")
 *
 * ข้อจำกัดโดยเจตนา:
 *  - เติมได้เฉพาะ attribute ที่ rule engine ดูแลอยู่แล้ว (use_case/function/context/style/space)
 *    ไม่แตะ attribute ที่เป็นของ AI-only และไม่แตะค่าที่วัดได้
 *  - confidence ไม่เกิน 0.6 (ต่ำกว่าหลักฐานจากคำจริง)
 *  - เติมเฉพาะเมื่อ "ค่ายังไม่มี" — ไม่ทับของเดิม
 */
import type { EnrichedTag } from './types';
import { valueLabel, type AttrId } from './vocab';

export type HeuristicAttr = Extract<AttrId, 'use_case' | 'function' | 'context' | 'style' | 'space'>;

export interface HeuristicInput {
  /** ชื่อ + สเปก + ตัวเลือก (ตัวพิมพ์เล็ก) ใช้หาคำเสริม */
  text: string;
  category: string;
  product_type: string;
  /** มีค่านี้อยู่แล้วหรือยัง (จากพจนานุกรมคำ) */
  has: (attr: HeuristicAttr, valueId: string) => boolean;
}

interface Rule {
  id: string;
  reason: string;
  when: (i: HeuristicInput) => boolean;
  emit: { attribute: HeuristicAttr; value_id: string; confidence: number };
}

const inSet = (value: string, set: string[]) => set.includes(value);

/**
 * ตารางกฎ — เรียงจากหลักฐานที่แรงที่สุดไปหาอ่อน
 * เพิ่มกฎใหม่ได้ แต่ต้องมีเหตุผลที่ตรวจย้อนได้เสมอ
 */
export const HEURISTIC_RULES: Rule[] = [
  {
    id: 'desk->desk_work',
    reason: 'ชนิดสินค้า: โต๊ะทำงาน',
    when: (i) => inSet(i.product_type, ['desk', 'standing_desk']),
    emit: { attribute: 'use_case', value_id: 'desk_work', confidence: 0.55 },
  },
  {
    id: 'desk->workspace',
    reason: 'ชนิดสินค้า: โต๊ะทำงาน',
    when: (i) => inSet(i.product_type, ['desk', 'standing_desk']),
    emit: { attribute: 'context', value_id: 'workspace', confidence: 0.5 },
  },
  {
    id: 'lamp->lighting',
    reason: 'ชนิดสินค้า: โคมไฟ',
    when: (i) => i.product_type === 'lamp',
    emit: { attribute: 'function', value_id: 'lighting', confidence: 0.55 },
  },
  {
    id: 'lamp+อ่าน->task_lighting',
    reason: 'ชนิดโคมไฟ + คำว่า "อ่าน"',
    when: (i) => i.product_type === 'lamp' && i.text.includes('อ่าน'),
    emit: { attribute: 'function', value_id: 'task_lighting', confidence: 0.5 },
  },
  {
    id: 'storage->storage',
    reason: 'ชนิดสินค้า: ชั้นวาง/ตู้/กล่องเก็บของ',
    when: (i) => inSet(i.product_type, ['shelf', 'cabinet', 'storage_box']),
    emit: { attribute: 'function', value_id: 'storage', confidence: 0.55 },
  },
  {
    id: 'chair->seating',
    reason: 'ชนิดสินค้า: เก้าอี้',
    when: (i) => i.product_type === 'chair',
    emit: { attribute: 'function', value_id: 'seating', confidence: 0.55 },
  },
  {
    id: 'sleep_types->bedroom',
    reason: 'ชนิดสินค้า: เตียง/ที่นอน/หมอน',
    when: (i) => inSet(i.product_type, ['bed', 'mattress', 'pillow']),
    emit: { attribute: 'context', value_id: 'bedroom', confidence: 0.55 },
  },
  {
    id: 'sleep_types->sleep',
    reason: 'ชนิดสินค้า: เตียง/ที่นอน/หมอน',
    when: (i) => inSet(i.product_type, ['bed', 'mattress', 'pillow']),
    emit: { attribute: 'use_case', value_id: 'sleep', confidence: 0.5 },
  },
  {
    id: 'storage_types->organizing',
    reason: 'ชนิดสินค้า: ชั้นวาง/ตู้/กล่องเก็บของ',
    when: (i) => inSet(i.product_type, ['shelf', 'cabinet', 'storage_box']),
    emit: { attribute: 'use_case', value_id: 'organizing', confidence: 0.5 },
  },
  {
    id: 'cookware->cooking',
    reason: 'ชนิดสินค้า: หม้อ/กระทะ/เครื่องใช้ในครัว',
    when: (i) => inSet(i.product_type, ['cookware', 'appliance']),
    emit: { attribute: 'use_case', value_id: 'cooking', confidence: 0.5 },
  },
  {
    id: 'kitchenware->dining',
    reason: 'ชนิดสินค้า: จานชาม/อุปกรณ์ครัว',
    when: (i) => i.product_type === 'kitchenware',
    emit: { attribute: 'use_case', value_id: 'dining', confidence: 0.5 },
  },
  {
    id: 'skincare->skincare',
    reason: 'ชนิดสินค้า: สกินแคร์',
    when: (i) => i.product_type === 'skincare',
    emit: { attribute: 'use_case', value_id: 'skincare', confidence: 0.55 },
  },
  {
    id: 'makeup->makeup',
    reason: 'ชนิดสินค้า: เครื่องสำอาง',
    when: (i) => i.product_type === 'makeup',
    emit: { attribute: 'use_case', value_id: 'makeup', confidence: 0.55 },
  },
  {
    id: 'haircare->grooming',
    reason: 'ชนิดสินค้า: ผลิตภัณฑ์ผม',
    when: (i) => i.product_type === 'haircare',
    emit: { attribute: 'use_case', value_id: 'grooming', confidence: 0.5 },
  },
  {
    id: 'fitness->fitness',
    reason: 'ชนิดสินค้า: อุปกรณ์ฟิตเนส',
    when: (i) => i.product_type === 'fitness_equipment',
    emit: { attribute: 'use_case', value_id: 'fitness', confidence: 0.55 },
  },
  {
    id: 'pet_types->pet_care',
    reason: 'ชนิดสินค้า: อาหาร/อุปกรณ์สัตว์เลี้ยง',
    when: (i) => inSet(i.product_type, ['pet_food', 'pet_accessory']),
    emit: { attribute: 'use_case', value_id: 'pet_care', confidence: 0.5 },
  },
  {
    id: 'decor->decoration',
    reason: 'ชนิดสินค้า: ของแต่งบ้าน',
    when: (i) => i.product_type === 'decor',
    emit: { attribute: 'use_case', value_id: 'decoration', confidence: 0.5 },
  },
  {
    id: 'kitchen_category->kitchen',
    reason: 'หมวดหมู่: ครัว',
    when: (i) => i.category === 'kitchen',
    emit: { attribute: 'context', value_id: 'kitchen', confidence: 0.5 },
  },
  {
    id: 'bed_desk->bedroom',
    reason: 'ชนิดสินค้า: โต๊ะวางบนเตียง',
    when: (i) => i.product_type === 'bed_desk',
    emit: { attribute: 'context', value_id: 'bedroom', confidence: 0.5 },
  },
  {
    id: 'table_types->surface',
    reason: 'ชนิดสินค้า: โต๊ะ',
    when: (i) =>
      inSet(i.product_type, [
        'desk',
        'standing_desk',
        'dining_table',
        'coffee_table',
        'side_table',
        'picnic_table',
        'folding_table',
        'bed_desk',
      ]),
    emit: { attribute: 'function', value_id: 'surface', confidence: 0.5 },
  },
];

export interface HeuristicTag {
  attribute: HeuristicAttr;
  tag: EnrichedTag;
}

export function applyHeuristics(input: HeuristicInput): HeuristicTag[] {
  const out: HeuristicTag[] = [];
  for (const rule of HEURISTIC_RULES) {
    try {
      if (!rule.when(input)) continue;
      const { attribute, value_id, confidence } = rule.emit;
      if (input.has(attribute, value_id)) continue;
      out.push({
        attribute,
        tag: {
          id: value_id,
          value: valueLabel(attribute, value_id),
          confidence,
          evidence: [`กฎ: ${rule.reason}`],
          rule: rule.id,
        },
      });
    } catch {
      /* กฎที่พังต้องไม่ทำให้ enrichment ทั้งชุดล้ม */
    }
  }
  return out;
}
