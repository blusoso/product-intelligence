import type { Product, Relation, Job, Source, Activity } from './types';

export const TAX = {
  cat: ['Home & Living', 'Gadget', 'Beauty', 'Fashion'],
  st: ['Cozy', 'Minimal', 'Budget'],
  au: ['Renter', 'Student', 'Family', 'Budget'],
};
export const TYPES = ['คู่กัน', 'ชุดเดียวกัน', 'ทดแทนกัน', 'ขายเป็นชุด', 'ควรโปรโมทต่อ'];

export const initialProducts: Product[] = [
  { id:1, sku:'SKU-1001', ext:'tiktok:1001', name:'Sunset Lamp', plat:'tiktok', cat:'Home & Living', price:590, cm:12, t:4, rel:3, st:'Active', up:'วันนี้ 09:12', a:'lamp', g:0, sty:['Cozy','Minimal'], au:['Renter','Student','Budget'] },
  { id:2, sku:'SKU-1002', ext:'shopee:1002', name:'Desk Mat', plat:'shopee', cat:'Gadget', price:390, cm:15, t:5, rel:4, st:'Active', up:'เมื่อวาน', a:'mat', g:1, sty:['Cozy','Minimal'], au:['Student','Budget'] },
  { id:3, sku:'SKU-1003', ext:'tiktok:1003', name:'Monitor Stand', plat:'tiktok', cat:'Gadget', price:450, cm:10, t:4, rel:2, st:'รอตรวจ', up:'8 ต.ค.', a:'stand', g:2, sty:['Minimal'], au:['Student','Renter'] },
  { id:4, sku:'SKU-1004', ext:'shopee:1004', name:'Wall Shelf', plat:'shopee', cat:'Home & Living', price:320, cm:11, t:3, rel:2, st:'Active', up:'7 ต.ค.', a:'mat', g:3, sty:['Minimal','Budget'], au:['Renter','Family','Budget'] },
  { id:5, sku:'SKU-1005', ext:'tiktok:1005', name:'Glow Serum', plat:'tiktok', cat:'Beauty', price:450, cm:14, t:5, rel:1, st:'Active', up:'5 ต.ค.', a:'serum', g:1, sty:['Cozy','Budget'], au:['Student','Budget'] },
  { id:6, sku:'SKU-1006', ext:'tiktok:1006', name:'Canvas Tote', plat:'tiktok', cat:'Fashion', price:290, cm:13, t:4, rel:1, st:'ซ่อน', up:'3 ต.ค.', a:'tote', g:3, sty:['Minimal','Budget'], au:['Student','Budget','Family'] },
  { id:7, sku:'SKU-1007', ext:'shopee:1007', name:'Storage Basket', plat:'shopee', cat:'Home & Living', price:280, cm:13, t:4, rel:0, st:'รอตรวจ', up:'2 ต.ค.', a:'tote', g:0, sty:['Cozy','Budget'], au:['Family','Renter'] },
  { id:8, sku:'SKU-1008', ext:'shopee:1008', name:'Cable Tray', plat:'shopee', cat:'Gadget', price:250, cm:18, t:4, rel:1, st:'Active', up:'1 ต.ค.', a:'stand', g:2, sty:['Minimal'], au:['Student','Budget'] },
  { id:9, sku:'SKU-1009', ext:'tiktok:1009', name:'Hair Towel', plat:'tiktok', cat:'Beauty', price:220, cm:16, t:5, rel:0, st:'รอตรวจ', up:'1 ต.ค.', a:'serum', g:1, sty:['Cozy'], au:['Student','Family'] },
  { id:10, sku:'SKU-1010', ext:'tiktok:1010', name:'Linen Shirt', plat:'tiktok', cat:'Fashion', price:690, cm:12, t:4, rel:0, st:'Active', up:'30 ก.ย.', a:'tote', g:3, sty:['Minimal','Cozy'], au:['Budget'] },
  { id:11, sku:'SKU-1011', ext:'shopee:1011', name:'Lumi Lamp Mini', plat:'shopee', cat:'Home & Living', price:540, cm:11, t:4, rel:1, st:'Active', up:'29 ก.ย.', a:'lamp', g:2, sty:['Cozy'], au:['Student','Renter'] },
];

export const initialRelations: Relation[] = [
  { id:1, a:1, b:2, ty:'คู่กัน', c:3, ev:'โปรโมทคู่กัน 12 ครั้ง', src:'Auto', st:'รอตรวจ', w:.82, x:{ 'โปรโมทคู่กัน (co-promotion)':'12 ครั้ง','Audience overlap':'Cozy 78% · Budget 64%','Creator overlap':'9 คน','Co-save / co-click':'31 / 54' } },
  { id:2, a:2, b:3, ty:'ชุดเดียวกัน', c:2, ev:'Cozy overlap 78%', src:'Auto', st:'รอตรวจ', w:.74, x:{ 'โปรโมทคู่กัน (co-promotion)':'7 ครั้ง','Audience overlap':'Cozy 78%','Creator overlap':'6 คน','Co-save / co-click':'18 / 29' } },
  { id:3, a:1, b:3, ty:'ชุดเดียวกัน', c:2, ev:'Desk Setup เดียวกัน', src:'Auto', st:'อนุมัติ', w:.7, x:{ 'โปรโมทคู่กัน (co-promotion)':'5 ครั้ง','Audience overlap':'Budget 60%','Creator overlap':'4 คน','Co-save / co-click':'12 / 20' } },
  { id:4, a:1, b:11, ty:'ทดแทนกัน', c:2, ev:'ราคาใกล้กัน', src:'Manual', st:'อนุมัติ', w:.55, x:{ 'โปรโมทคู่กัน (co-promotion)':'—','Audience overlap':'Cozy 70%','Creator overlap':'3 คน','Co-save / co-click':'8 / 15' } },
  { id:5, a:5, b:6, ty:'ควรโปรโมทต่อ', c:1, ev:'co-click 6 ครั้ง', src:'Auto', st:'ซ่อน', w:.31, x:{ 'โปรโมทคู่กัน (co-promotion)':'1 ครั้ง','Audience overlap':'Budget 40%','Creator overlap':'1 คน','Co-save / co-click':'2 / 6' } },
  { id:6, a:4, b:1, ty:'ชุดเดียวกัน', c:2, ev:'ตกแต่งผนังคู่กับโคมไฟ', src:'Auto', st:'รอตรวจ', w:.6, x:{ 'โปรโมทคู่กัน (co-promotion)':'4 ครั้ง','Audience overlap':'Renter 66%','Creator overlap':'3 คน','Co-save / co-click':'9 / 17' } },
  { id:7, a:8, b:3, ty:'คู่กัน', c:3, ev:'co-promotion 9 ครั้ง', src:'Auto', st:'รอตรวจ', w:.79, x:{ 'โปรโมทคู่กัน (co-promotion)':'9 ครั้ง','Audience overlap':'Student 71%','Creator overlap':'7 คน','Co-save / co-click':'22 / 35' } },
];

export const initialJobs: Job[] = [
  { t:'09:00', s:'Shopee scraper', n:38, u:102, f:0, st:'สำเร็จ' },
  { t:'03:00', s:'TikTok Shop API', n:17, u:64, f:2, st:'ล้มเหลว' },
  { t:'03:00', s:'Shopee scraper', n:42, u:118, f:0, st:'สำเร็จ' },
  { t:'21:00', s:'Shopee scraper', n:11, u:95, f:0, st:'สำเร็จ' },
];

export const initialSources: Source[] = [
  { id:'shopee', n:'Shopee scraper', sub:'สคริปต์ของคุณ · ทุก 6 ชั่วโมง', on:true, nw:42, up:118, f:0, note:'ล่าสุด 03:00 · ถัดไป 09:00', p:'shopee' },
  { id:'tiktok', n:'TikTok Shop API', sub:'API ทางการ · ทุกวัน 03:00', on:true, nw:17, up:64, f:2, note:'ล่าสุด 03:00 · ถัดไป พรุ่งนี้ 03:00', p:'tiktok' },
  { id:'manual', n:'Manual JSON', sub:'อัปโหลดจากหน้า Products', on:false, nw:0, up:0, f:0, note:'ใช้เมื่อต้องการนำเข้าเอง', p:'file' },
];

export const initialActivity: Activity[] = [
  { who:'Admin', text:'อนุมัติคู่ Sunset Lamp → Desk Mat', when:'10 นาที' },
  { who:'ระบบ', text:'Ingestion TikTok Shop สำเร็จ +17 สินค้า', when:'03:00' },
  { who:'Admin', text:'publish Ranking v11', when:'เมื่อวาน' },
];

export const POOL: [string, string, number, string, number][] = [
  ['Bamboo Tray','Home & Living',320,'tote',0],
  ['Phone Stand','Gadget',199,'stand',2],
  ['Lip Balm Set','Beauty',260,'serum',1],
  ['Canvas Cap','Fashion',350,'tote',3],
  ['LED Strip','Gadget',420,'lamp',2],
  ['Soy Candle','Home & Living',380,'lamp',0],
];
