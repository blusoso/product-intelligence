#!/usr/bin/env node
/**
 * audit-keywords — ตรวจทุก keyword ใน vocab/taxonomy
 * ---------------------------------------------------
 *   npm run audit:keywords
 *   npm run audit:keywords -- --json
 *
 * exit 1 = มีคำที่ยังไม่ผ่าน policy (SEO หลุด/collision/คำที่ถูกถอดแต่ยังอยู่)
 */
import { auditKeywords } from '../lib/network/keyword-registry';

const asJson = process.argv.includes('--json');
const { entries, issues, counts } = auditKeywords();

if (asJson) {
  console.log(JSON.stringify({ counts, issues, entries }, null, 2));
} else {
  console.log(`คำทั้งหมด ${counts.terms} คำ`);
  console.log(`  attribute entries : ${counts.attributes}`);
  console.log(`  product_type entries: ${counts.productTypes}`);
  console.log(`  category entries  : ${counts.categories}`);
  console.log('');
  console.log('— ตัวอย่างการจัดบทบาท (20 คำแรก) —');
  for (const entry of entries.slice(0, 20)) {
    const owners = entry.owners.map((o) => `${o.kind}:${o.value}`).join(', ');
    console.log(`  ${entry.term} → ${owners}`);
  }
  console.log('');
  if (issues.length) {
    console.log(`❌ พบปัญหา ${issues.length} รายการ`);
    for (const issue of issues) console.log(`  [${issue.kind}] ${issue.term}: ${issue.detail}`);
  } else {
    console.log('✅ ไม่พบปัญหา — ทุกคำอยู่ในบทบาทที่อนุญาต');
  }
}

if (issues.length) process.exitCode = 1;
