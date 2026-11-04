/**
 * Adapter ระหว่าง "คอลัมน์จริงใน DB" กับ "รูปทรงที่ UI ใช้"
 *
 * หลัง migration 20261103131500_dedupe_schema.sql ฐานข้อมูลเก็บ 1 ความหมาย
 * เพียง 1 คอลัมน์ (trust_score / commission_per_unit / status / product_type /
 * province) แต่หน้า admin เดิมยังใช้ชื่อย่อ (t / cm / st / cat / location)
 * จึงแปลงที่ขอบ API แทนการเก็บซ้ำใน DB
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอตรวจ',
  approved: 'Active',
  rejected: 'ตีกลับ',
  archived: 'ซ่อน',
};

const LABEL_STATUS: Record<string, string> = {
  รอตรวจ: 'pending',
  Active: 'approved',
  อนุมัติ: 'approved',
  ซ่อน: 'archived',
  ตีกลับ: 'rejected',
  ปฏิเสธ: 'rejected',
};

/** ป้ายสถานะที่ใช้แสดงผล (รหัส DB → ภาษาไทย) */
export const STATUS_TEXT: Record<string, string> = {
  pending: 'รอตรวจ',
  approved: 'เผยแพร่',
  rejected: 'ตีกลับ',
  archived: 'ซ่อน',
};

export const statusText = (code: string | null | undefined): string =>
  STATUS_TEXT[String(code ?? '')] ?? String(code ?? '—');

/** DB row → รูปทรงที่ UI ใช้ (เพิ่ม t / cm / st / cat / location แบบอ่านอย่างเดียว) */
export function toLegacyProduct<T extends Record<string, any> | null>(row: T): T {
  if (!row) return row;
  const r: Record<string, any> = { ...row };
  r.st = STATUS_LABEL[String(r.status)] ?? r.status ?? 'รอตรวจ';
  r.cat = r.product_type ?? 'Other';
  r.t = r.trust_score ?? 0;
  r.cm = r.commission_per_unit ?? 0;
  r.location = r.province ?? null;
  return r as T;
}

/**
 * body จาก UI → คอลัมน์จริงใน DB
 * ตัดฟิลด์ที่ไม่มีคอลัมน์แล้ว (st / cat / t / cm / location / _raw) ออก
 * พร้อมย้ายค่าไปยังคอลัมน์ canonical ถ้าปลายทางไม่ได้ส่งค่ามาเอง
 */
export function toDbColumns(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...input };
  delete out._raw;
  delete out._duplicates;

  if ('st' in out) {
    const mapped = LABEL_STATUS[String(out.st)];
    if (mapped && !out.status) out.status = mapped;
    delete out.st;
  }
  if ('cat' in out) {
    if (out.cat != null && out.product_type == null) out.product_type = out.cat;
    delete out.cat;
  }
  if ('t' in out) {
    if (out.trust_score == null) out.trust_score = Number(out.t) || 0;
    delete out.t;
  }
  if ('cm' in out) {
    if (out.commission_per_unit == null) out.commission_per_unit = Number(out.cm) || 0;
    delete out.cm;
  }
  if ('location' in out) {
    if (out.location && out.province == null) out.province = out.location;
    delete out.location;
  }

  // ค่า null ที่ PostgREST ไม่ควรรับสำหรับคอลัมน์ NOT NULL
  for (const key of ['name', 'ext', 'status', 'product_type']) {
    if (key in out && out[key] === null) delete out[key];
  }
  return out;
}
