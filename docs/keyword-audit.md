# Keyword Audit — บทบาทของทุกคำใน Vocab/Taxonomy

เอกสารนี้สรุปว่า "คำแต่ละคำทำหน้าที่อะไร" และตรวจซ้ำได้ด้วยคำสั่ง:

```bash
npm run audit:keywords        # ตาราง + fail เมื่อมี collision/คำ SEO หลุด
npm run test:rules            # ชุดทดสอบ rule/SEO/phrase memory/evidence
```

ตัวตรวจอยู่ใน `lib/network/keyword-registry.ts` และอ่าน keyword จากแหล่งจริง:

- `lib/network/vocab.ts` — ทุก `th[]` + `en[]`
- `lib/network/taxonomy.ts` — `CATEGORIES` + `PRODUCT_TYPES`
- `lib/network/seo-keywords.ts` — คำ SEO/marketing
- `lib/network/phrase-memory.ts` — `GENERIC` และ role policy

## บทบาทคำ (roles)

| role | ใช้เป็นหลักฐานของ | ตัวอย่าง |
|---|---|---|
| `use_case` | สินค้าใช้ทำอะไร | `อ่านหนังสือ`, `เขียนหนังสือ`, `ทำอาหาร` |
| `function` | ทำหน้าที่อะไร | `ให้แสงสว่าง`, `เก็บของ`, `พื้นที่วางของ` |
| `context` | ใช้ที่ไหน | `ห้องนอน`, `ห้องครัว`, `มุมทำงาน` |
| `style` | สไตล์ (เฉพาะสเปก/ตัวเลือก) | `ลอฟท์`, `สแกนดิเนเวียน`, `วินเทจ` |
| `space` | เหมาะกับพื้นที่แบบไหน | `ประหยัดพื้นที่`, `ติดผนัง`, `พกพา` |
| `audience` | กลุ่มผู้ใช้ | `นักเรียน`, `เด็ก`, `ผู้สูงอายุ` |
| `feature` | ฟีเจอร์ที่ตรวจได้ | `ปรับระดับ`, `พับได้`, `ใช้ถ่าน` |
| `product_type` | ชนิดสินค้า | `bed_desk`, `coffee_table`, `desk` |
| `category` | หมวดหยาบ | `furniture`, `kitchen`, `beauty` |
| `material` | วัสดุ (แยกจาก finish) | `ไม้`, `เหล็ก`, `ผ้า` |
| `vision` | ต้องเห็นจากภาพเท่านั้น | `tablet_slot`, `metal_frame` |
| `marketing` | ห้ามเป็นหลักฐาน | `ญี่ปุ่น`, `มินิมอล`, `พรีเมียม` |
| `generic` | คำกว้าง ห้ามจำวลี | `โต๊ะ`, `ของ`, `สินค้า` |

## กฎที่บังคับ

1. **Product-type word ห้ามเป็น use_case/function/context**
   เช่น `โต๊ะทำงาน`, `ที่นอน`, `หมอน`, `ลำโพง`, `ชั้นวาง`, `หม้อ` ถูกถอดออกจาก vocab
   แล้วให้ `heuristics.ts` เติม use_case/function จาก `product_type` แทน
2. **SEO/marketing ไม่สร้าง style/type**
   `ญี่ปุ่น`, `เกาหลี`, `มูจิ`, `มินิมอล`, `หรูหรา`, `พรีเมียม` ถูก mask ก่อนจับ style
   และ Phrase Memory ปฏิเสธวลีที่มีคำเหล่านี้
3. **Style อ่านจาก spec/options เท่านั้น** ไม่ใช้ title (title เป็นที่อยู่หลักของ SEO)
4. **Negation-aware**
   `ไม่ปรับระดับ`, `ไม่พับได้`, `ไม่กันน้ำ`, `ไม่ต้องประกอบ` ต้องไม่สร้างค่าบวก
5. **Vision-only**
   `visual_features`/`material_visual` ไม่ถูกสร้างจาก text AI หรือ Phrase Memory
6. **Evidence invariant**
   ทุกค่า `source='evidence'` ต้องมี `evidence[]` ไม่ว่าง

## Collision ที่แก้แล้ว

| คำ | ปัญหาเดิม | วิธีแก้ |
|---|---|---|
| `โต๊ะญี่ปุ่น` | ถูก map เป็น `coffee_table` และ style japanese | ถอดจาก keyword; ใช้ type override ตามบริบท |
| `กาแฟ` | ชน `โต๊ะกาแฟ` → หมวดอาหาร | ถอด; ใช้ `เมล็ดกาแฟ`/`coffee bean` |
| `สีน้ำ` | ชน `สีน้ำตาล` → paint | ถอด; ใช้ `สีน้ำมัน`/`สีอะคริลิก` |
| `desk` | ชน `desk lamp` | ถอด; ใช้ compound desk terms |
| `light` | ชน `light wood` | ถอด; ใช้ `lamp`/`desk lamp` |
| `notebook` | ชน laptop/stationery | เก็บไว้ที่ laptop; stationery ใช้ `สมุด` |
| `เคส` | กว้าง | ใช้ `เคสโทรศัพท์`/`phone case` |
| `ชุด` | ชน `ชุดโต๊ะ` | ใช้ `เสื้อผ้า` |
| `จอ` | สั้น/กำกวม | ใช้ `จอคอม`/`มอนิเตอร์` |
| `แป้ง` | ชนแป้งทำอาหาร | ใช้ `แป้งแต่งหน้า` |
| `ประกอบ` | กำกวม | ใช้ `ประกอบเอง`/`ไม่ต้องประกอบ` |

## การเพิ่ม keyword ใหม่

1. เพิ่มใน `vocab.ts` หรือ `taxonomy.ts`
2. ถ้าเป็นคำที่อาจชน/เป็น SEO ให้เพิ่มใน `REMOVED_KEYWORDS` หรือ `ALLOWED_OVERLAPS` พร้อมเหตุผล
3. รัน `npm run audit:keywords` และ `npm run test:rules`
4. ถ้าเป็น vocab ใหม่ ให้ bump `VOCAB_VERSION`; ถ้าแก้ prompt ให้ bump `PROMPT_VERSION`
