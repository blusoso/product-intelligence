/**
 * one-off: ลบแท็ก visual ที่มาจากข้อความ (origin ai/phrase) สำหรับแถวที่อ่านภาพแล้ว (meta.vision)
 * ใช้ REST ของ Supabase — ไม่เรียก AI เพิ่ม ไม่มีค่าใช้จ่าย
 */
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const VISUAL = new Set(['visual_features', 'material_visual']);
const dry = process.argv.includes('--dry');

const res = await fetch(
  `${base}/rest/v1/products?select=id,network_node_key,ai_enrichment&ai_enrichment=not.is.null&limit=1000`,
  { headers },
);
if (!res.ok) throw new Error(`select failed ${res.status} ${await res.text()}`);
const rows = await res.json();

let touched = 0;
let dropped = 0;
const detail = [];
for (const row of rows) {
  const ai = row.ai_enrichment;
  const vision = ai?.meta?.vision;
  const tags = Array.isArray(ai?.tags) ? ai.tags : [];
  if (!vision) continue;
  const kept = tags.filter((t) => {
    const fromText = t.origin === 'ai' || t.origin === 'phrase' || !t.origin;
    return !(fromText && VISUAL.has(t.attribute));
  });
  if (kept.length === tags.length) continue;
  const removed = tags.filter((t) => !kept.includes(t));
  touched += 1;
  dropped += removed.length;
  detail.push(`${row.network_node_key}: -${removed.map((t) => `${t.attribute}=${t.value_id}`).join(', ')}`);
  if (dry) continue;
  const patch = await fetch(`${base}/rest/v1/products?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ ai_enrichment: { ...ai, tags: kept } }),
  });
  if (!patch.ok) throw new Error(`patch ${row.id} failed ${patch.status} ${await patch.text()}`);
}

console.log(`rows scanned: ${rows.length}`);
console.log(`${dry ? 'would update' : 'updated'} rows: ${touched}  |  tags removed: ${dropped}`);
for (const d of detail) console.log('  ' + d);
