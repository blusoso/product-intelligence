/**
 * ตัวแปลงคำตอบโมเดลเป็น JSON ที่ทนทาน
 * ------------------------------------
 * โมเดลบางตัวตอบเป็น markdown fence, ใส่คำอธิบายนำ, หรือมี trailing comma
 * ฟังก์ชันชุดนี้ใช้ร่วมกันทั้งชั้นข้อความ (ai.ts) และชั้นภาพ (vision.ts)
 */

/** ตัดข้อความที่เป็น JSON ก้อนแรก (รองรับ string ที่มีวงเล็บอยู่ข้างใน) */
export function sliceBalanced(text: string, open: '{' | '['): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON.parse แบบผ่อนปรน: ตัด trailing comma */
export function parseLoose(text: string): any | undefined {
  const tries = [text, text.replace(/,\s*([}\]])/g, '$1')];
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      /* ลองแบบถัดไป */
    }
  }
  return undefined;
}

/** แปลงคำตอบของโมเดลเป็น array ของ items (ทนต่อ markdown fence / ข้อความห่อ) */
export function parseContent(content: string): any[] | null {
  const text = content.trim();
  const candidates: string[] = [text];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (m[1]?.trim()) candidates.push(m[1].trim());
  }
  for (const open of ['{', '['] as const) {
    const sliced = sliceBalanced(text, open);
    if (sliced) candidates.push(sliced);
  }

  let parsed: any;
  for (const c of candidates) {
    const v = parseLoose(c);
    if (v !== undefined) {
      parsed = v;
      break;
    }
  }
  if (parsed === undefined) return null;
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.data)) return parsed.data;
  // เผื่อโมเดลห่อด้วย key อื่น: ใช้อาเรย์ตัวแรกที่เจอ
  const arrays = Object.values(parsed ?? {}).filter(Array.isArray);
  if (arrays.length === 1) return arrays[0] as any[];
  return null;
}
