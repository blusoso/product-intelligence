/**
 * Canonical product — จัดกลุ่ม listing ที่เป็น "สินค้ารุ่นเดียวกัน"
 * ---------------------------------------------------------------
 * หลักการ: ไม่ลบ/ไม่ merge แถว และไม่รวมเพราะชื่อคล้ายกันอย่างเดียว
 * ต้องมีหลักฐานอย่างน้อยหนึ่งอย่าง:
 *   1) รหัสรุ่น (model code) ตรงกัน และ product_type เดียวกัน  → confidence 1.0
 *   2) แบรนด์เดียวกัน + ชื่อ normalized ใกล้กัน + ขนาดตรงกัน + ราคาต่าง ≤15% → 0.9
 * ผลลัพธ์คือ canonical_id ติดบน record + edge "same_product_as" (ไม่ใช่การยุบข้อมูล)
 */
import { createHash } from 'node:crypto';
import type { CanonicalSummary, NormalizedProduct, PipelineConfig } from './types';
import { jaccard, shingles } from './text';

export const EMPTY_CANONICAL: CanonicalSummary = {
  groups: 0,
  listings_in_groups: 0,
  linked: 0,
  proposals: 0,
  ambiguous: [],
};

const LABELED_CODE = /(?:รุ่น|โมเดล|model|mpn|sku|รหัสสินค้า|รหัสรุ่น)\s*[:#=]?\s*([A-Za-z0-9][A-Za-z0-9\-_/.]{2,})/i;
const TOKEN_CODE = /\b([A-Z]{2,6}[-/ ]?\d{2,6}[A-Z0-9-]{0,4})\b/;

const CODE_SPEC_NAME = /รุ่น|โมเดล|model|mpn|sku|รหัส/i;

function normalizeCode(raw: string): string | null {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (code.length < 4 || code.length > 24) return null;
  if (!/[A-Z]/.test(code) || !/\d/.test(code)) return null;
  // กันขนาดสินค้า/ปี/ตัวเลขล้วนถูกตีความเป็นรหัสรุ่น
  if (/^\d+X\d+/.test(code) || /^\d{4}$/.test(code)) return null;
  return code;
}

/** ดึงรหัสรุ่นจากสเปกก่อน แล้วจึงจากชื่อสินค้า */
export function extractModelCode(p: NormalizedProduct): string | null {
  for (const s of p.specs ?? []) {
    if (!CODE_SPEC_NAME.test(String(s.name ?? ''))) continue;
    const labeled = LABELED_CODE.exec(String(s.value ?? ''));
    const code = normalizeCode(labeled?.[1] ?? String(s.value ?? ''));
    if (code) return code;
  }
  const labeled = LABELED_CODE.exec(p.name);
  if (labeled) {
    const code = normalizeCode(labeled[1]);
    if (code) return code;
  }
  const token = TOKEN_CODE.exec(p.name.toUpperCase());
  if (token) return normalizeCode(token[1]);
  return null;
}

function priceCompatible(a: number, b: number): number {
  if (!a || !b) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

function groupId(basis: string, key: string): string {
  return `cn:${createHash('sha1').update(`${basis}|${key}`).digest('hex').slice(0, 10)}`;
}

function markPrimary(group: NormalizedProduct[], confidence: number, evidence: string, id: string) {
  const sorted = [...group].sort(
    (a, b) => b.quality_score - a.quality_score || b.monthly_sold - a.monthly_sold,
  );
  const primary = sorted[0]?.node_key;
  for (const p of group) {
    p.canonical_id = id;
    p.canonical_confidence = confidence;
    p.canonical_evidence = evidence;
    p.listing_count = group.length;
    p.is_primary_listing = p.node_key === primary;
  }
}

/**
 * ติด canonical_id ให้สินค้า (แก้ object ใน array โดยตรง)
 * mode:
 *  - off: ไม่ทำอะไร
 *  - evidence: จัดกลุ่ม + สร้าง edge (ผ่าน pipeline/graph)
 *  - propose: จัดกลุ่มและติดป้าย แต่ไม่ลิงก์ในกราฟ (ให้คนตรวจก่อน)
 */
export function assignCanonical(
  products: NormalizedProduct[],
  cfg: Pick<PipelineConfig, 'canonicalize' | 'canonical_threshold'>,
): CanonicalSummary {
  if (cfg.canonicalize === 'off' || !products.length) return { ...EMPTY_CANONICAL };

  const summary: CanonicalSummary = { ...EMPTY_CANONICAL };
  const codeBuckets = new Map<string, NormalizedProduct[]>();
  const pending: NormalizedProduct[] = [];

  for (const p of products) {
    const code = extractModelCode(p);
    if (code) {
      const key = `${p.product_type}|${code}`;
      const list = codeBuckets.get(key) ?? [];
      list.push(p);
      codeBuckets.set(key, list);
    } else {
      pending.push(p);
    }
  }

  // 1) รหัสรุ่นตรงกัน
  for (const [key, list] of codeBuckets) {
    const code = key.slice(key.indexOf('|') + 1);
    if (list.length === 1) continue;
    const id = groupId('model_code', key);
    markPrimary(list, 1, `model_code:${code}`, id);
    summary.groups += 1;
    summary.listings_in_groups += list.length;
  }

  // 2) แบรนด์ + ขนาด + ชื่อใกล้กัน + ราคาใกล้กัน
  const buckets = new Map<string, NormalizedProduct[]>();
  for (const p of pending) {
    if (!p.brand || !p.size_label) continue;
    const key = `${p.brand.toLowerCase()}|${p.size_label}`;
    const list = buckets.get(key) ?? [];
    list.push(p);
    buckets.set(key, list);
  }
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      if (used.has(list[i].node_key)) continue;
      const group = [list[i]];
      for (let j = i + 1; j < list.length; j++) {
        const other = list[j];
        if (used.has(other.node_key)) continue;
        const sim = jaccard(shingles(list[i].name, 3), shingles(other.name, 3));
        if (sim < 0.8) continue;
        if (priceCompatible(list[i].price, other.price) < 0.85) continue;
        group.push(other);
      }
      if (group.length < 2) continue;
      for (const p of group) used.add(p.node_key);
      const id = groupId('name_size_price', `${key}|${list[i].node_key}`);
      markPrimary(group, 0.9, `name_brand_size:${key}`, id);
      summary.groups += 1;
      summary.listings_in_groups += group.length;
    }
  }

  // 3) รหัสเดียวกันแต่คนละ product_type = น่าสงสัย (ไม่จัดกลุ่มข้ามชนิด)
  const byCode = new Map<string, Set<string>>();
  for (const [key] of codeBuckets) {
    const [type, code] = key.split('|');
    const set = byCode.get(code) ?? new Set<string>();
    set.add(type);
    byCode.set(code, set);
  }
  for (const [code, types] of byCode) {
    if (types.size > 1) summary.ambiguous.push(`${code} (${[...types].join(', ')})`);
  }

  if (cfg.canonicalize === 'evidence') {
    summary.linked = summary.groups;
  } else {
    summary.proposals = summary.groups;
    // โหมด propose: เก็บไว้ดู แต่ไม่ให้กราฟลิงก์
    summary.linked = 0;
  }
  return summary;
}

/** คู่ (primary → listing อื่น) ที่จะใช้สร้าง edge same_product_as */
export function canonicalEdgePairs(products: NormalizedProduct[]): Array<{
  source: string;
  target: string;
  weight: number;
  evidence: Record<string, any>;
}> {
  const groups = new Map<string, NormalizedProduct[]>();
  for (const p of products) {
    if (!p.canonical_id || p.listing_count < 2) continue;
    const list = groups.get(p.canonical_id) ?? [];
    list.push(p);
    groups.set(p.canonical_id, list);
  }
  const pairs: Array<{ source: string; target: string; weight: number; evidence: Record<string, any> }> = [];
  for (const [id, list] of groups) {
    const primary = list.find((p) => p.is_primary_listing) ?? list[0];
    for (const p of list) {
      if (p.node_key === primary.node_key) continue;
      pairs.push({
        source: primary.node_key,
        target: p.node_key,
        weight: Math.min(1, Math.max(0.5, primary.canonical_confidence)),
        evidence: {
          canonical_id: id,
          basis: primary.canonical_evidence,
          listing_count: list.length,
        },
      });
    }
  }
  return pairs;
}
