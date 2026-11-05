/**
 * scripts/gap-analysis.ts
 * ----------------------------------
 * แยก Gap ของ Attribute ออกเป็น 3 ประเภท:
 *  1) Data Gap: ข้อความไม่มีข้อมูลจริง (AI ตอบไม่ได้)
 *  2) Validation Gap: AI ตอบแล้วแต่โดน validateAiTags ตัดทิ้ง
 *  3) Rule Gap: Rule ไม่จับ และ AI ไม่ได้ลอง (เช่น second pass ไม่ครอบคลุม)
 *
 * Usage:
 *   npx tsx scripts/gap-analysis.ts --limit 200
 */

import { createClient } from '@supabase/supabase-js';
import { ATTR_IDS, ATTRIBUTE_MAP, type AttrId } from '../lib/network/vocab';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface GapRow {
  attribute: string;
  total: number;
  from_rule: number;
  from_ai: number;
  from_both: number;
  empty: number;
  data_gap: number;
  validation_gap: number;
  rule_gap: number;
}

async function main() {
  const limit = Number(
    process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 500,
  );

  const { data, error } = await supabase
    .from('products')
    .select('ext, enrichment, ai_enrichment')
    .not('enrichment', 'is', null)
    .limit(limit);

  if (error) throw error;

  const stats = new Map<string, GapRow>();
  // เพิ่ม computed attr เข้าไปด้วย เพื่อให้ Dashboard เห็นครบ
  const allAttrs: string[] = [
    ...ATTR_IDS,
    'target_context',
    'price_segment',
  ];

  for (const id of allAttrs) {
    stats.set(id, {
      attribute: id,
      total: 0,
      from_rule: 0,
      from_ai: 0,
      from_both: 0,
      empty: 0,
      data_gap: 0,
      validation_gap: 0,
      rule_gap: 0,
    });
  }

  for (const row of data ?? []) {
    const enrichment = row.enrichment as any;
    const ai = row.ai_enrichment as any;
    const aiTags: Array<{ attribute: string }> = ai?.tags ?? [];

    for (const id of allAttrs) {
      const s = stats.get(id)!;
      s.total += 1;

      const fromRule = hasRuleValue(enrichment, id);
      const fromAi = aiTags.some((t) => t.attribute === id);

      if (fromRule && fromAi) s.from_both += 1;
      else if (fromRule) s.from_rule += 1;
      else if (fromAi) s.from_ai += 1;
      else {
        s.empty += 1;
        // แยกประเภท Gap
        const hasAiError = Array.isArray(ai?.meta?.error);
        if (hasAiError) {
          s.validation_gap += 1;
        } else if (!isEvidenceCapable(id)) {
          s.rule_gap += 1;
        } else {
          s.data_gap += 1;
        }
      }
    }
  }

  // Print ตาราง
  console.log(
    '\nAttribute               | total | rule | ai  | both | empty | dataGap | validGap | ruleGap',
  );
  console.log(
    '------------------------|-------|------|-----|------|-------|---------|----------|--------',
  );
  for (const id of allAttrs) {
    const s = stats.get(id)!;
    console.log(
      `${id.padEnd(22)} | ${String(s.total).padStart(5)} | ${String(s.from_rule).padStart(4)} | ${String(s.from_ai).padStart(3)} | ${String(s.from_both).padStart(4)} | ${String(s.empty).padStart(5)} | ${String(s.data_gap).padStart(7)} | ${String(s.validation_gap).padStart(8)} | ${String(s.rule_gap).padStart(7)}`,
    );
  }
}

/**
 * ตรวจว่ามี rule-based value ของ attribute นี้หรือไม่
 * - CHANGELOG: เปลี่ยน signature เป็น `attr: string` เพื่อไม่ให้ TypeScript ฟ้อง
 *   ตอนที่ส่ง 'target_context' / 'price_segment' (computed attr ที่ไม่อยู่ใน AttrId)
 */
function hasRuleValue(enrichment: any, attr: string): boolean {
  if (!enrichment) return false;
  switch (attr) {
    case 'use_case':
      return (enrichment.use_cases?.length ?? 0) > 0;
    case 'function':
      return (enrichment.functions?.length ?? 0) > 0;
    case 'context':
      return (enrichment.contexts?.length ?? 0) > 0;
    case 'style':
      return (enrichment.styles?.length ?? 0) > 0;
    case 'space':
      return (enrichment.spaces?.length ?? 0) > 0;
    case 'audience':
      return (enrichment.audiences?.length ?? 0) > 0;
    case 'target_context':
      return (enrichment.target_contexts?.length ?? 0) > 0;
    case 'price_segment':
      return enrichment.price_segment?.basis !== 'unknown';
    default:
      return false;
  }
}

/**
 * ตรวจว่า Attribute นี้ "rule ตรวจได้หรือไม่"
 * (อ้างจาก vocab — ถ้าเป็น ai-only ก็ไม่ถือว่าเป็น rule_gap)
 * - ถ้าเป็น computed attr (target_context, price_segment) → ไม่ใช่ rule_gap
 */
function isEvidenceCapable(attr: string): boolean {
  if (attr === 'target_context' || attr === 'price_segment') return true; // computed ไม่ใช่ rule gap
  const def = ATTRIBUTE_MAP[attr as AttrId];
  return def?.evidence_capable ?? false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});