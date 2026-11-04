#!/usr/bin/env node
/**
 * seed-phrases.mjs — เรียนรู้ "พจนานุกรมวลี" จากผล AI ที่มีอยู่แล้ว
 * ------------------------------------------------------------------
 * ใช้ก่อน bump PROMPT_VERSION: ความรู้จาก quote รอบก่อนจะถูกเก็บไว้ใน
 * enrichment_phrases แล้ว ค่อยล้าง cache — ไม่ต้องจ่ายค่า AI ซ้ำเพื่อเรียนรู้ใหม่
 *
 * ต้องมี dev server รันอยู่ (ตรรกะทั้งหมดอยู่ในแอป: lib/network/phrase-memory.ts)
 *   npm run dev
 *   node scripts/seed-phrases.mjs --dry          # ดูจำนวนก่อน
 *   node scripts/seed-phrases.mjs                # เขียนจริง
 *   node scripts/seed-phrases.mjs --url http://127.0.0.1:3000
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = value('url', process.env.PI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dry = flag('dry');

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { ok: false, error: text.slice(0, 300) } };
  }
}

const before = await call('GET', '/api/network/phrases/harvest');
if (!before.json.ok) {
  console.error('อ่านสถานะพจนานุกรมวลีไม่ได้:', before.json.error ?? before.status);
  console.error(`ตรวจว่า dev server รันอยู่ที่ ${base}`);
  process.exit(1);
}
console.log('ก่อนเรียน:', before.json);

const result = await call('POST', '/api/network/phrases/harvest', dry ? { dry: true } : {});
if (!result.json.ok) {
  console.error('เรียนรู้วลีไม่สำเร็จ:', result.json.error ?? result.status);
  process.exit(1);
}
console.log(dry ? 'ผลตรวจ (dry):' : 'ผลการเรียนรู้:', result.json);

if (!dry) {
  const after = await call('GET', '/api/network/phrases/harvest');
  console.log('หลังเรียน:', after.json);
  if ((after.json.active ?? 0) === 0) {
    console.log('หมายเหตุ: ยังไม่มีวลีที่เป็น active — ต้องเจอวลีเดิมซ้ำ ≥ 2 ครั้งก่อน');
  }
}
