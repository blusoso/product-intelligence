This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## AI Enrichment (ชั้น AI ของ network pipeline)

สินค้า 1 ชิ้นถูกเข้าใจ 2 ชั้นที่แยกกันเด็ดขาด:

| ชั้น | เก็บที่ | ใครเขียน | กติกา |
|---|---|---|---|
| หลักฐาน (evidence) | `products.enrichment` | กฎแบบ deterministic | ทุกค่ามี `evidence` + `confidence` |
| AI | `products.ai_enrichment` | โมเดล + พจนานุกรมวลี | enum-only, ต้องมี `quote` ที่หาเจอจริงในข้อความ |

AI **ห้ามเขียนค่าที่วัดได้** (ขนาด/น้ำหนัก/ราคา) และค่าที่ไม่ตรงกับ `lib/network/vocab.ts` จะถูกทิ้งทันที

### Keyword guardrails (2026-11)

- คำ SEO/โฆษณา (`ญี่ปุ่น`, `เกาหลี`, `มูจิ`, `มินิมอล`, `หรูหรา`, `พรีเมียม`, `minimal`, ฯลฯ)
  **ไม่ถูกใช้เป็นหลักฐาน** ของ `style`/`product_type`; ถูก mask ก่อนจับ style
  และ Phrase Memory ปฏิเสธวลีที่มีคำเหล่านี้
- `โต๊ะญี่ปุ่น` ไม่ใช่ keyword ของ type ใดโดยตรง — ใช้ `detectTypeOverride()`:
  มี `ปรับระดับ`/`ขาพับ`/`บนเตียง` → `bed_desk`; มี `นั่งพื้น`/`โต๊ะกลาง`/`โต๊ะกาแฟ` → `coffee_table`
- `เด็ก` → `audience` (`kids`/`baby`) เท่านั้น; `เขียนหนังสือ` → `use_case = writing`
- `visual_features`/`material_visual` เป็น vision-only (text AI/Phrase Memory สร้างไม่ได้)
- ทุก keyword ต้องผ่าน `npm run audit:keywords` — ดู `docs/keyword-audit.md`

### ลำดับการทำงาน (ถูกที่สุด → แพงที่สุด)

1. **กฎ/หลักฐาน** — `lib/network/enrich.ts` + `heuristics.ts` (ฟรี)
2. **พจนานุกรมวลี** — `lib/network/phrase-memory.ts` เรียนจาก quote ที่ grounded แล้ว
   **ต้องสแกนหาวลีในข้อความจริงทุกครั้ง** ก่อนใช้ (ไม่เชื่อ cache ตรง ๆ)
3. **AI** — เรียกเฉพาะแถวที่กฎให้ไม่ครบ (`ai_gate_min_text_fields`); แถวที่ถูกข้ามบันทึกเป็น
   `meta.status='disabled'` (ไม่ค้างเป็นงาน)
4. **VLM อ่านภาพ** — `lib/network/vision.ts` ใช้ `deepseek-flash` ตัวเดียวกับชั้นข้อความ
   (DeepSeek อ่านภาพได้ตั้งแต่ v4-flash-vision และรวมเข้า `deepseek-flash` แล้ว จึงใช้
   `AI_API_KEY` เดิมได้ ไม่ต้องมี key แยก — ตั้ง `VISION_API_KEY` เฉพาะเมื่อจะใช้เจ้าอื่น)
   ส่งเฉพาะรูปหน้าปกของแถวที่ข้อความให้ข้อมูลไม่พอ · ปิด thinking (`VISION_THINKING=0`)
   ไม่งั้น reasoning กิน `max_tokens` จนคำตอบว่าง · cache ตาม URL รูป (อ่านแล้วไม่พบค่าก็ cache)
   ทุกค่าจากภาพต้องมี `region`/`bbox` มิฉะนั้นต้องมั่นใจ ≥ 0.6

ค่าที่ AI ให้แล้วขัดกับหลักฐานจะไม่ถูกใช้ — เข้าคิว `enrichment_conflicts` ให้คนตัดสินที่
**ขัดแย้งรอตรวจ** ในหน้า `/network` (`accept_ai` เขียน `attribute_overrides` ให้ pipeline ไม่ทับ)

### สคริปต์ที่ใช้บ่อย

```bash
npm run dev                    # ต้องเปิดไว้สำหรับ seed:phrases
npm run db:push                # apply migration (หา pooler ให้เองถ้า direct เป็น IPv6)
npm run db:push -- --dry       # ดูว่าจะ apply อะไร
npm run seed:phrases           # เรียนรู้วลีจากผล AI เดิม (ทำก่อน bump prompt/cache)
npm run eval:enrich            # วัดผล + ตรวจ invariant (exit 2 = มีของหลุด)
npm run audit:keywords         # ตรวจทุก keyword ว่าไม่มี SEO/collision หลุด
npm run test:rules             # ชุดทดสอบ rule/SEO/phrase memory/evidence
```

`eval:enrich` ตรวจ invariant ที่ต้องเป็น 0 เสมอ: attribute นอกรายการ · visual ไม่มี region/bbox ·
visual จากข้อความหลังอ่านภาพ · evidence ไม่มี provenance · grounded แต่ไม่มี quote ·
quote หาไม่เจอในข้อความ

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
