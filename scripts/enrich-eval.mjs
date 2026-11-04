#!/usr/bin/env node
/**
 * enrich-eval.mjs — วัดผล "AI enrichment" ก่อน/หลังเปลี่ยนระบบ
 * -------------------------------------------------------------
 * วัดจากข้อมูลจริงในตาราง products (อ่านอย่างเดียว ไม่เขียนอะไร)
 *   node scripts/enrich-eval.mjs
 *   node scripts/enrich-eval.mjs --limit 500 --json
 *
 * ตัวชี้วัด:
 *  1) evidence coverage — กฎตีความได้กี่กลุ่มต่อแถว (ใช้คำนวณ AI gating)
 *  2) phrase memory potential — quote ที่ (attribute,value) เดียวกันซ้ำในหลายสินค้า
 *  3) visual attributes — แถวที่ยังไม่มีค่าจากภาพ และมี/ไม่มีรูป
 *  4) invariants — ตรวจว่าข้อมูลที่บันทึกไว้ไม่ละเมิดกติกา
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const asJson = args.includes('--json');
const limit = Math.max(1, Number(value('limit', 200)) || 200);

/** attribute ที่ระบบยอมรับ (ต้องตรงกับ lib/network/vocab.ts) */
const ATTR_IDS = [
  'use_case', 'function', 'context', 'style', 'space', 'audience', 'occasion',
  'adjustability', 'power_source', 'assembly', 'finish', 'visual_features', 'material_visual',
];
const VISUAL = ['visual_features', 'material_visual'];
const GATE_MIN = 2;

function readEnv() {
  const out = {};
  try {
    const raw = fs.readFileSync('.env', 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* ไม่มี .env */
  }
  return out;
}

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error('ไม่พบ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ใน .env');
  process.exit(1);
}

const select = 'name,description,specs,options,product_type,image,images_all,enrichment,ai_enrichment';
const res = await fetch(`${url}/rest/v1/products?select=${select}&limit=${limit}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error('อ่าน products ไม่ได้:', res.status, (await res.text()).slice(0, 200));
  process.exit(1);
}
const rows = await res.json();
const total = rows.length;

const evidenceFields = (r) => {
  const e = r.enrichment ?? {};
  // ต้องตรงกับ evidenceFieldCount() ใน lib/network/ai.ts (2 กลุ่มหลัก)
  return ['use_cases', 'contexts'].filter((k) => Array.isArray(e[k]) && e[k].length > 0).length;
};

let gated = 0;
let bothEmpty = 0;
let withAnyEvidence = 0;
for (const r of rows) {
  const n = evidenceFields(r);
  if (n >= GATE_MIN) gated += 1;
  if (n === 0) bothEmpty += 1;
  if (n > 0) withAnyEvidence += 1;
}

/* ── phrase memory potential ───────────────────────────────── */
const quoteGroups = new Map(); // attr|value|quote -> count
let tagged = 0;
let grounded = 0;
let phraseOrigin = 0;
for (const r of rows) {
  for (const t of r.ai_enrichment?.tags ?? []) {
    tagged += 1;
    if (t.origin === 'phrase') phraseOrigin += 1;
    if (!t.grounded || !t.quote) continue;
    grounded += 1;
    const q = String(t.quote).trim().toLowerCase();
    if (q.length < 4) continue;
    const k = `${t.attribute}|${t.value_id}|${q}`;
    quoteGroups.set(k, (quoteGroups.get(k) ?? 0) + 1);
  }
}
const reusableQuotes = [...quoteGroups.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
const reusableRate = grounded ? reusableQuotes / grounded : 0;

/* ── visual ─────────────────────────────────────────────────── */
// "ยังไม่เคยอ่านภาพ" = ไม่มี meta.vision และไม่มีค่าจากภาพ (ตรงกับ vision_missing ใน pipeline)
const missingVisual = rows.filter(
  (r) =>
    !r.ai_enrichment?.meta?.vision &&
    !(r.ai_enrichment?.tags ?? []).some((t) => VISUAL.includes(t.attribute)),
);
// อ่านภาพแล้วแต่ไม่ได้ค่าอะไร (รูปไม่ชัด/สินค้าไม่มีดีเทลที่มองเห็น) — ไม่ใช่ "ยังไม่ได้ทำ"
const readWithoutVisual = rows.filter(
  (r) =>
    Boolean(r.ai_enrichment?.meta?.vision) &&
    !(r.ai_enrichment?.tags ?? []).some((t) => VISUAL.includes(t.attribute)),
).length;
const imagesOf = (r) =>
  [
    ...(Array.isArray(r.images_all) ? r.images_all : []),
    r.image,
  ]
    .map((x) => (typeof x === 'string' ? x : x?.url ? String(x.url) : ''))
    .filter((u) => /^https?:\/\//i.test(u));
const missingVisualWithImage = missingVisual.filter((r) => imagesOf(r).length > 0).length;

/* ── invariants ─────────────────────────────────────────────── */
const violations = {
  unknown_attribute: 0,
  visual_without_anchor: 0,
  grounded_without_quote: 0,
  quote_not_found: 0,
  /** แถวที่อ่านภาพแล้ว ต้องไม่มี visual ที่มาจากข้อความ (ภาพคือแหล่งเดียวของค่าที่มองเห็น) */
  visual_from_text_after_vision: 0,
  /** ค่า source=evidence ต้องมี evidence ไม่ว่าง (province/brand/base รวมถึง rule tags) */
  evidence_without_provenance: 0,
  /** แถวที่ข้อความเพี้ยน (mojibake) — ข้ามการตรวจ quote เพราะต้นทางเสียอยู่แล้ว */
  skipped_mojibake: 0,
};
const MOJIBAKE = /[ÃÂ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;
// ต้องตรงกับ lib/network/text.ts (stripPromo) ไม่งั้นจะฟ้อง quote ผิดพลาด
// เพราะแอปตัด emoji/คำโฆษณาก่อนตรวจ grounding — quote จึงคร่อมข้อความที่ถูกตัดออกได้
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu;
const norm = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(EMOJI, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
for (const r of rows) {
  const broken = MOJIBAKE.test(String(r.name ?? ''));
  if (broken) violations.skipped_mojibake += 1;
  const haystack = norm(
    [
      r.name,
      // รูปแบบเดียวกับ toInput() ใน ai.ts: "ชื่อสเปก: ค่า"
      ...(Array.isArray(r.specs) ? r.specs.map((s) => `${s?.name ?? ''}: ${s?.value ?? ''}`) : []),
      ...(Array.isArray(r.options) ? r.options.map((o) => String(o?.name ?? o?.model_id ?? '')) : []),
      r.description,
    ].join(' '),
  );
  const sawVision = Boolean(r.ai_enrichment?.meta?.vision);
  const enrichment = r.enrichment ?? {};
  for (const key of ['use_cases', 'functions', 'contexts', 'styles', 'spaces', 'audiences', 'target_contexts']) {
    for (const tag of Array.isArray(enrichment[key]) ? enrichment[key] : []) {
      if (!Array.isArray(tag?.evidence) || tag.evidence.length === 0) {
        violations.evidence_without_provenance += 1;
      }
    }
  }
  for (const t of r.ai_enrichment?.tags ?? []) {
    if (!ATTR_IDS.includes(t.attribute)) violations.unknown_attribute += 1;
    if (VISUAL.includes(t.attribute) && sawVision && t.origin !== 'vision') {
      violations.visual_from_text_after_vision += 1;
    }
    if (VISUAL.includes(t.attribute) && t.origin === 'vision' && !t.region && !t.bbox) {
      violations.visual_without_anchor += 1;
    }
    if (t.grounded && !t.quote && t.evidence_type !== 'image') violations.grounded_without_quote += 1;
    if (t.grounded && t.quote && haystack && !haystack.includes(norm(t.quote)) && !broken) {
      violations.quote_not_found += 1;
    }
  }
}

const report = {
  total,
  evidence: {
    rows_with_any: withAnyEvidence,
    rows_with_none: bothEmpty,
    /** แถวที่จะถูกข้ามการเรียก AI เมื่อตั้ง ai_gate_min_text_fields = 2 */
    would_gate: gated,
    would_call_ai: total - gated,
    gate_saving_pct: total ? Math.round(((total - gated) / total) * 100) : 0,
  },
  ai: {
    tags: tagged,
    grounded,
    phrase_origin: phraseOrigin,
    reusable_quotes: reusableQuotes,
    reuse_rate_pct: Math.round(reusableRate * 100),
  },
  visual: {
    missing: missingVisual.length,
    missing_with_image: missingVisualWithImage,
    read_without_tags: readWithoutVisual,
  },
  violations,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`วัดจาก ${total} แถว (limit ${limit})\n`);
  console.log('— หลักฐาน (rule) —');
  console.log(`  มีหลักฐานอย่างน้อย 1 กลุ่ม : ${report.evidence.rows_with_any}`);
  console.log(`  ไม่มีเลย                    : ${report.evidence.rows_with_none}`);
  console.log(`  จะถูกข้าม AI (gate ≥ ${GATE_MIN})   : ${report.evidence.would_gate}`);
  console.log(`  ยังต้องเรียก AI             : ${report.evidence.would_call_ai} (ประหยัด ${report.evidence.gate_saving_pct}%)`);
  console.log('\n— AI / พจนานุกรมวลี —');
  console.log(`  แท็กทั้งหมด                : ${report.ai.tags}`);
  console.log(`  grounded (มี quote จริง)    : ${report.ai.grounded}`);
  console.log(`  มาจากพจนานุกรมวลีแล้ว      : ${report.ai.phrase_origin}`);
  console.log(`  quote ที่ใช้ซ้ำได้          : ${report.ai.reusable_quotes} (${report.ai.reuse_rate_pct}%)`);
  console.log('\n— ภาพ —');
  console.log(`  ยังไม่เคยอ่านภาพ            : ${report.visual.missing}`);
  console.log(`  ในนั้นที่มีรูปให้อ่าน      : ${report.visual.missing_with_image}`);
  console.log(`  อ่านแล้วไม่พบค่าที่มองเห็น  : ${report.visual.read_without_tags}`);
  console.log('\n— invariants (ต้องเป็น 0 ทั้งหมด) —');
  console.log(`  attribute นอกรายการ        : ${violations.unknown_attribute}`);
  console.log(`  visual ไม่มี region/bbox   : ${violations.visual_without_anchor}`);
  console.log(`  visual จากข้อความ (อ่านภาพแล้ว): ${violations.visual_from_text_after_vision}`);
  console.log(`  evidence ไม่มี provenance  : ${violations.evidence_without_provenance}`);
  console.log(`  grounded แต่ไม่มี quote    : ${violations.grounded_without_quote}`);
  console.log(`  quote หาไม่เจอในข้อความ    : ${violations.quote_not_found} (ข้ามแถว mojibake ${violations.skipped_mojibake} แถว)`);
}

const failed = [
  violations.unknown_attribute,
  violations.visual_without_anchor,
  violations.visual_from_text_after_vision,
  violations.evidence_without_provenance,
  violations.grounded_without_quote,
  violations.quote_not_found,
].some((n) => n > 0);
process.exit(failed ? 2 : 0);
