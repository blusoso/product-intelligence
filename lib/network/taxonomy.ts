/**
 * Canonical taxonomy for Thai marketplace data
 * --------------------------------------------
 * ใช้ "keyword scoring" แบบ deterministic: คำที่ยาว/เฉพาะเจาะจงกว่ามีน้ำหนักมากกว่า
 * ทำให้ "โต๊ะคอมพิวเตอร์" ชนะ "โต๊ะ" เมื่อเทียบกับ product_type
 * ไม่มี dependency ภายนอก → รันได้ทั้งใน API route และ script
 */
import {
  BED_CONTEXT_TERMS,
  COFFEE_CONTEXT_TERMS,
  JP_TABLE_TERMS,
  WEAK_BED_FEATURES,
  hasAffirmedTerm,
} from './seo-keywords';

export interface CategoryDef {
  id: string;
  label: string;
  keywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'furniture',
    label: 'Furniture',
    keywords: ['เฟอร์นิเจอร์', 'โต๊ะ', 'เก้าอี้', 'ชั้นวาง', 'ตู้', 'เตียง', 'โซฟา', 'ม้านั่ง', 'ตู้เสื้อผ้า', 'หัวเตียง', 'นวม', 'furniture', 'desk', 'chair', 'table', 'shelf', 'cabinet', 'wardrobe', 'sofa', 'bed'],
  },
  {
    id: 'home_living',
    label: 'Home & Living',
    keywords: ['ของแต่งบ้าน', 'โคมไฟ', 'โคม', 'หลอดไฟ', 'ไฟตั้งโต๊ะ', 'พรม', 'เสื่อ', 'หมอน', 'ผ้าม่าน', 'ม่าน', 'ที่นอน', 'ผ้าปู', 'ปลอกหมอน', 'กระจก', 'กรอบรูป', 'เทียน', 'กล่องเก็บของ', 'ตะกร้า', 'ราวตากผ้า', 'ไม้แขวน', 'home', 'living', 'lamp', 'rug', 'curtain', 'pillow', 'decor', 'storage'],
  },
  {
    id: 'kitchen',
    label: 'Kitchen & Dining',
    keywords: ['หม้อ', 'กระทะ', 'จาน', 'ชาม', 'แก้ว', 'ช้อน', 'ส้อม', 'มีด', 'เขียง', 'ถาด', 'กล่องข้าว', 'กระติก', 'กาต้มน้ำ', 'เครื่องปั่น', 'ไมโครเวฟ', 'หม้อทอด', 'kitchen', 'cookware', 'plate', 'pan', 'pot', 'mug', 'blender'],
  },
  {
    id: 'electronics',
    label: 'Gadget & Electronics',
    keywords: ['มือถือ', 'โทรศัพท์', 'หูฟัง', 'ลำโพง', 'สายชาร์จ', 'ที่ชาร์จ', 'พาวเวอร์แบงค์', 'เคสโทรศัพท์', 'กระจกกันรอย', 'เมาส์', 'คีย์บอร์ด', 'มอนิเตอร์', 'จอคอม', 'แล็ปท็อป', 'โน้ตบุ๊ก', 'แท็บเล็ต', 'กล้อง', 'ไมค์', 'เราเตอร์', 'หุ่นยนต์ดูดฝุ่น', 'พัดลม', 'เครื่องฟอกอากาศ', 'phone', 'headphone', 'speaker', 'charger', 'cable', 'mouse', 'keyboard', 'monitor', 'laptop', 'tablet', 'camera', 'router', 'gadget'],
  },
  {
    id: 'beauty',
    label: 'Beauty & Personal Care',
    keywords: ['ครีม', 'เซรั่ม', 'โลชั่น', 'ลิป', 'แป้งแต่งหน้า', 'รองพื้น', 'อายไลเนอร์', 'มาส์ก', 'สบู่', 'แชมพู', 'บำรุงผิว', 'น้ำหอม', 'สกินแคร์', 'เครื่องสำอาง', 'serum', 'cream', 'lotion', 'lipstick', 'foundation', 'mask', 'shampoo', 'perfume', 'skincare', 'cosmetic', 'beauty'],
  },
  {
    id: 'fashion',
    label: 'Fashion',
    keywords: ['เสื้อผ้า', 'เสื้อ', 'กางเกง', 'กระโปรง', 'เดรส', 'ถุงเท้า', 'รองเท้า', 'กระเป๋า', 'เป้', 'หมวก', 'เข็มขัด', 'แว่นตา', 'นาฬิกา', 'เครื่องประดับ', 'shirt', 'pants', 'dress', 'shoes', 'bag', 'hat', 'belt', 'glasses', 'watch', 'jewelry', 'fashion'],
  },
  {
    id: 'sport',
    label: 'Sport & Outdoor',
    keywords: ['วิ่ง', 'ฟิตเนส', 'โยคะ', 'ดัมเบล', 'บาร์เบล', 'เสื่อโยคะ', 'จักรยาน', 'ลูกบอล', 'แบดมินตัน', 'กอล์ฟ', 'ว่ายน้ำ', 'ตั้งแคมป์', 'fitness', 'yoga', 'dumbbell', 'bicycle', 'sport', 'running', 'gym', 'camping'],
  },
  {
    id: 'kids',
    label: 'Kids & Baby',
    keywords: ['เด็ก', 'ของเล่น', 'ทารก', 'ตุ๊กตา', 'รถเข็น', 'ขวดนม', 'ผ้าอ้อม', 'kid', 'baby', 'toy', 'doll', 'stroller'],
  },
  {
    id: 'pet',
    label: 'Pet Supplies',
    keywords: ['สุนัข', 'แมว', 'อาหารสุนัข', 'อาหารแมว', 'ทรายแมว', 'กรง', 'สายจูง', 'pet', 'dog', 'cat', 'litter'],
  },
  {
    id: 'office',
    label: 'Stationery & Office',
    keywords: ['ปากกา', 'ดินสอ', 'สมุด', 'กระดาษ', 'แฟ้ม', 'เครื่องเขียน', 'กล่องดินสอ', 'ปริ้นเตอร์', 'หมึกพิมพ์', 'stationery', 'pen', 'notebook', 'paper', 'printer'],
  },
  {
    id: 'tools',
    label: 'Tools & DIY',
    keywords: ['สว่าน', 'ไขควง', 'ค้อน', 'เลื่อย', 'ประแจ', 'น็อต', 'ตะปู', 'เครื่องมือ', 'ปืนกาว', 'สีทาบ้าน', 'สีน้ำมัน', 'สีอะคริลิก', 'tool', 'drill', 'screwdriver', 'hammer', 'saw', 'wrench', 'paint'],
  },
  {
    id: 'automotive',
    label: 'Automotive',
    keywords: ['ยางรถ', 'น้ำมันเครื่อง', 'ที่ปัดน้ำฝน', 'เบาะรถ', 'กล้องติดรถ', 'car', 'tire', 'automotive', 'motor oil'],
  },
  {
    id: 'health',
    label: 'Health & Wellness',
    keywords: ['วิตามิน', 'อาหารเสริม', 'เครื่องวัด', 'หน้ากาก', 'เจลล้างมือ', 'ยา', 'supplement', 'vitamin', 'health'],
  },
  {
    id: 'food',
    label: 'Food & Beverage',
    keywords: ['อาหารสำเร็จรูป', 'ขนม', 'เมล็ดกาแฟ', 'กาแฟคั่ว', 'กาแฟสำเร็จรูป', 'ชาเขียว', 'ชาไทย', 'น้ำผึ้ง', 'ผลไม้', 'food', 'snack', 'coffee bean', 'ground coffee', 'tea'],
  },
];

export interface TypeDef {
  id: string;
  label: string;
  category: string;
  keywords: string[];
}

export const PRODUCT_TYPES: TypeDef[] = [
  { id: 'desk', label: 'โต๊ะทำงาน/คอมพิวเตอร์', category: 'furniture', keywords: ['โต๊ะคอมพิวเตอร์', 'โต๊ะคอม', 'โต๊ะทำงาน', 'โต๊ะเขียนหนังสือ', 'โต๊ะเกมมิ่ง', 'โต๊ะเล่นเกม', 'computer desk', 'office desk', 'gaming desk', 'study desk'] },
  { id: 'dining_table', label: 'โต๊ะกินข้าว', category: 'furniture', keywords: ['โต๊ะกินข้าว', 'โต๊ะทานข้าว', 'โต๊ะอาหาร', 'dining table'] },
  // "โต๊ะญี่ปุ่น" เป็นคำ SEO ที่ใช้ได้กับทั้งโต๊ะกาแฟและโต๊ะวางเตียง → ไม่ใช้เป็น keyword เดี่ยว
  // การแยกประเภทใช้ detectTypeOverride() จากฟีเจอร์/บริบทแทน
  { id: 'coffee_table', label: 'โต๊ะกาแฟ', category: 'furniture', keywords: ['โต๊ะกาแฟ', 'โต๊ะกลาง', 'โต๊ะนั่งพื้น', 'coffee table'] },
  { id: 'picnic_table', label: 'โต๊ะสนาม/พกพา', category: 'furniture', keywords: ['โต๊ะสนาม', 'โต๊ะปิคนิค', 'โต๊ะพกพา', 'โต๊ะตั้งแคมป์', 'picnic table', 'camping table'] },
  { id: 'side_table', label: 'โต๊ะข้าง', category: 'furniture', keywords: ['โต๊ะข้าง', 'โต๊ะข้างเตียง', 'โต๊ะวางของ', 'โต๊ะเล็ก', 'โต๊ะกลม', 'side table', 'nightstand'] },
  { id: 'folding_table', label: 'โต๊ะพับ', category: 'furniture', keywords: ['โต๊ะพับ', 'โต๊ะพับได้', 'folding table'] },
  { id: 'bed_desk', label: 'โต๊ะวางบนเตียง', category: 'furniture', keywords: ['โต๊ะเตียง', 'โต๊ะวางบนเตียง', 'bed desk', 'bed table', 'lap desk'] },
  { id: 'standing_desk', label: 'โต๊ะปรับระดับ', category: 'furniture', keywords: ['โต๊ะปรับระดับ', 'โต๊ะยืน', 'standing desk'] },
  { id: 'chair', label: 'เก้าอี้', category: 'furniture', keywords: ['เก้าอี้สำนักงาน', 'เก้าอี้ทำงาน', 'เก้าอี้เกมมิ่ง', 'เก้าอี้', 'chair'] },
  { id: 'shelf', label: 'ชั้นวางของ', category: 'furniture', keywords: ['ชั้นวางหนังสือ', 'ชั้นวางของ', 'ชั้นหนังสือ', 'ชั้นวาง', 'bookshelf', 'shelf'] },
  { id: 'cabinet', label: 'ตู้/ตู้เสื้อผ้า', category: 'furniture', keywords: ['ตู้เสื้อผ้า', 'ตู้เก็บของ', 'ตู้', 'cabinet', 'wardrobe'] },
  { id: 'bed', label: 'เตียง', category: 'furniture', keywords: ['เตียงนอน', 'เตียง', 'bed frame', 'bed'] },
  { id: 'sofa', label: 'โซฟา', category: 'furniture', keywords: ['โซฟา', 'sofa', 'couch'] },
  { id: 'mattress', label: 'ที่นอน', category: 'furniture', keywords: ['ที่นอน', 'ฟูก', 'mattress'] },
  { id: 'lamp', label: 'โคมไฟ', category: 'home_living', keywords: ['โคมไฟ', 'ไฟตั้งโต๊ะ', 'ไฟอ่านหนังสือ', 'ไฟหัวเตียง', 'desk lamp', 'table lamp', 'lamp'] },
  { id: 'rug', label: 'พรม/เสื่อ', category: 'home_living', keywords: ['พรมปูพื้น', 'พรม', 'เสื่อ', 'rug', 'mat'] },
  { id: 'curtain', label: 'ผ้าม่าน', category: 'home_living', keywords: ['ผ้าม่าน', 'ม่าน', 'curtain'] },
  { id: 'pillow', label: 'หมอน', category: 'home_living', keywords: ['หมอน', 'ปลอกหมอน', 'pillow'] },
  { id: 'storage_box', label: 'กล่อง/ตะกร้าเก็บของ', category: 'home_living', keywords: ['กล่องเก็บของ', 'กล่องใส่ของ', 'ตะกร้า', 'storage box', 'basket'] },
  { id: 'decor', label: 'ของแต่งบ้าน', category: 'home_living', keywords: ['กรอบรูป', 'กระจกติดผนัง', 'โคมไฟตั้งพื้น', 'decor'] },
  { id: 'kitchenware', label: 'จานชาม/อุปกรณ์ครัว', category: 'kitchen', keywords: ['จาน', 'ชาม', 'แก้ว', 'ช้อน', 'ส้อม', 'มีด', 'เขียง', 'plate', 'mug'] },
  { id: 'cookware', label: 'หม้อ/กระทะ', category: 'kitchen', keywords: ['หม้อ', 'กระทะ', 'pot', 'pan'] },
  { id: 'appliance', label: 'เครื่องใช้ไฟฟ้าในครัว', category: 'kitchen', keywords: ['เครื่องปั่น', 'ไมโครเวฟ', 'หม้อทอด', 'กาต้มน้ำ', 'blender', 'microwave'] },
  { id: 'phone_accessory', label: 'อุปกรณ์มือถือ', category: 'electronics', keywords: ['เคสโทรศัพท์', 'กระจกกันรอย', 'สายชาร์จ', 'ที่ชาร์จ', 'พาวเวอร์แบงค์', 'phone case', 'charger', 'cable'] },
  { id: 'audio', label: 'หูฟัง/ลำโพง', category: 'electronics', keywords: ['หูฟัง', 'ลำโพง', 'headphone', 'earbud', 'speaker'] },
  { id: 'computer_accessory', label: 'อุปกรณ์คอมพิวเตอร์', category: 'electronics', keywords: ['เมาส์', 'คีย์บอร์ด', 'มอนิเตอร์', 'จอคอม', 'mouse', 'keyboard', 'monitor'] },
  { id: 'laptop', label: 'แล็ปท็อป', category: 'electronics', keywords: ['แล็ปท็อป', 'โน้ตบุ๊ก', 'laptop', 'notebook'] },
  { id: 'skincare', label: 'สกินแคร์', category: 'beauty', keywords: ['ครีม', 'เซรั่ม', 'โลชั่น', 'สกินแคร์', 'serum', 'cream', 'lotion'] },
  { id: 'makeup', label: 'เครื่องสำอาง', category: 'beauty', keywords: ['ลิป', 'แป้งแต่งหน้า', 'รองพื้น', 'อายไลเนอร์', 'lipstick', 'foundation'] },
  { id: 'haircare', label: 'ผลิตภัณฑ์ผม', category: 'beauty', keywords: ['แชมพู', 'ครีมนวดผม', 'shampoo'] },
  { id: 'fragrance', label: 'น้ำหอม', category: 'beauty', keywords: ['น้ำหอม', 'perfume'] },
  { id: 'shirt', label: 'เสื้อ', category: 'fashion', keywords: ['เสื้อยืด', 'เสื้อเชิ้ต', 'เสื้อ', 'shirt', 't-shirt'] },
  { id: 'pants', label: 'กางเกง', category: 'fashion', keywords: ['กางเกง', 'pants', 'jeans'] },
  { id: 'dress', label: 'ชุด/เดรส', category: 'fashion', keywords: ['เดรส', 'กระโปรง', 'dress', 'skirt'] },
  { id: 'shoes', label: 'รองเท้า', category: 'fashion', keywords: ['รองเท้า', 'shoes', 'sneaker'] },
  { id: 'bag', label: 'กระเป๋า', category: 'fashion', keywords: ['กระเป๋า', 'เป้', 'bag', 'backpack'] },
  { id: 'watch', label: 'นาฬิกา', category: 'fashion', keywords: ['นาฬิกา', 'watch'] },
  { id: 'jewelry', label: 'เครื่องประดับ', category: 'fashion', keywords: ['เครื่องประดับ', 'แหวน', 'สร้อย', 'jewelry'] },
  { id: 'fitness_equipment', label: 'อุปกรณ์ฟิตเนส', category: 'sport', keywords: ['ดัมเบล', 'บาร์เบล', 'เสื่อโยคะ', 'ฟิตเนส', 'dumbbell', 'yoga'] },
  { id: 'bike', label: 'จักรยาน', category: 'sport', keywords: ['จักรยาน', 'bicycle', 'bike'] },
  { id: 'toy', label: 'ของเล่น', category: 'kids', keywords: ['ของเล่น', 'ตุ๊กตา', 'toy', 'doll'] },
  { id: 'baby_gear', label: 'อุปกรณ์เด็ก', category: 'kids', keywords: ['รถเข็น', 'ขวดนม', 'ผ้าอ้อม', 'stroller', 'baby'] },
  { id: 'pet_food', label: 'อาหารสัตว์', category: 'pet', keywords: ['อาหารสุนัข', 'อาหารแมว', 'pet food'] },
  { id: 'pet_accessory', label: 'อุปกรณ์สัตว์เลี้ยง', category: 'pet', keywords: ['ทรายแมว', 'กรง', 'สายจูง', 'litter', 'pet'] },
  { id: 'stationery', label: 'เครื่องเขียน', category: 'office', keywords: ['ปากกา', 'ดินสอ', 'สมุด', 'กระดาษ', 'แฟ้ม', 'stationery', 'pen', 'paper'] },
  { id: 'printer', label: 'ปริ้นเตอร์/หมึก', category: 'office', keywords: ['ปริ้นเตอร์', 'หมึกพิมพ์', 'printer'] },
  { id: 'tool', label: 'เครื่องมือช่าง', category: 'tools', keywords: ['สว่าน', 'ไขควง', 'ค้อน', 'เลื่อย', 'ประแจ', 'เครื่องมือ', 'drill', 'tool'] },
  { id: 'paint', label: 'สี/วัสดุก่อสร้าง', category: 'tools', keywords: ['สีทาบ้าน', 'สีน้ำมัน', 'สีอะคริลิก', 'ปูน', 'paint'] },
  { id: 'car_accessory', label: 'อุปกรณ์รถยนต์', category: 'automotive', keywords: ['ยางรถ', 'น้ำมันเครื่อง', 'ที่ปัดน้ำฝน', 'เบาะรถ', 'car', 'tire'] },
  { id: 'health_device', label: 'อุปกรณ์สุขภาพ', category: 'health', keywords: ['เครื่องวัด', 'หน้ากาก', 'เจลล้างมือ', 'health'] },
  { id: 'supplement', label: 'อาหารเสริม', category: 'health', keywords: ['วิตามิน', 'อาหารเสริม', 'vitamin', 'supplement'] },
  { id: 'food', label: 'อาหาร/เครื่องดื่ม', category: 'food', keywords: ['ขนม', 'เมล็ดกาแฟ', 'กาแฟคั่ว', 'กาแฟสำเร็จรูป', 'ชาเขียว', 'น้ำผึ้ง', 'food', 'snack', 'coffee bean', 'ground coffee', 'tea'] },
  // fallback: มีคำว่าโต๊ะแต่ไม่มีชนิดที่ชัดกว่า
  { id: 'table_generic', label: 'โต๊ะ (ทั่วไป)', category: 'furniture', keywords: ['โต๊ะ'] },
];

export const BRANDS: string[] = [
  // Home / furniture
  'Homemark', 'IKEA', 'Index', 'SB Design Square', 'Koncept', 'Modernform', 'Rockworth',
  'Ergonomics', 'Ergo', 'Secretlab', 'Nitori', 'MUJI', 'HomePro', 'Thai Watsadu',
  'Boonthavorn', 'Hafele', 'ToTo', 'Cotto', 'American Standard', 'Cobra', 'Sphinx',
  'Lamptan', 'Elephant', 'Beger', 'Jorakay', 'TOA', 'Dulux', 'Nippon', '3M', 'Scotch',
  // Electronics
  'Apple', 'Samsung', 'Xiaomi', 'OPPO', 'vivo', 'realme', 'Huawei', 'Sony', 'JBL', 'Bose',
  'Anker', 'Baseus', 'UGREEN', 'Logitech', 'Razer', 'ASUS', 'Acer', 'Lenovo', 'HP', 'Dell',
  'MSI', 'TP-Link', 'Dyson', 'Philips', 'Panasonic', 'Canon', 'Epson', 'Brother',
  // Beauty / FMCG
  "L'Oreal", 'Loreal', 'Maybelline', "Pond's", 'Garnier', 'Biore', 'Nivea', 'Cetaphil',
  'CeraVe', 'La Roche-Posay', 'Sunsilk', 'Pantene', 'Head & Shoulders', 'Dove', 'Rexona',
  'Colgate', 'Oral-B', 'Sensodyne', 'Unicharm', 'Pampers', 'MamyPoko', 'BabyLove',
  // Sports / fashion
  'Nike', 'Adidas', 'Puma', 'Uniqlo', 'H&M', 'Zara', 'Decathlon',
  // Health
  'Blackmores', 'Swisse', 'Ensure', 'Nestle',
];

/** alias → canonical (ตัวพิมพ์เล็ก) */
export const BRAND_ALIASES: Record<string, string> = {
  'ikea': 'IKEA',
  'index living mall': 'Index',
  'index': 'Index',
  'sb design square': 'SB Design Square',
  'sb design': 'SB Design Square',
  'modern form': 'Modernform',
  'home mark': 'Homemark',
  'homemark': 'Homemark',
  'homepro': 'HomePro',
  'home pro': 'HomePro',
  'loreal': "L'Oreal",
  "l'oreal": "L'Oreal",
  'ponds': "Pond's",
  "pond's": "Pond's",
  'la roche posay': 'La Roche-Posay',
  'la roche-posay': 'La Roche-Posay',
  'cerave': 'CeraVe',
  'cetaphil': 'Cetaphil',
  'head and shoulders': 'Head & Shoulders',
  'oral b': 'Oral-B',
  'oral-b': 'Oral-B',
  'toto': 'ToTo',
  'american standard': 'American Standard',
  'thai watsadu': 'Thai Watsadu',
  'boonthavorn': 'Boonthavorn',
  'tp link': 'TP-Link',
  'tp-link': 'TP-Link',
  'jbl': 'JBL',
  'bose': 'Bose',
  'anker': 'Anker',
  'baseus': 'Baseus',
  'ugreen': 'UGREEN',
  'logitech': 'Logitech',
  'razer': 'Razer',
  'asus': 'ASUS',
  'acer': 'Acer',
  'lenovo': 'Lenovo',
  'dell': 'Dell',
  'msi': 'MSI',
  'dyson': 'Dyson',
  'philips': 'Philips',
  'panasonic': 'Panasonic',
  'xiaomi': 'Xiaomi',
  'samsung': 'Samsung',
  'apple': 'Apple',
  'sony': 'Sony',
  'oppo': 'OPPO',
  'vivo': 'vivo',
  'realme': 'realme',
  'huawei': 'Huawei',
  'nike': 'Nike',
  'adidas': 'Adidas',
  'puma': 'Puma',
  'uniqlo': 'Uniqlo',
  'decathlon': 'Decathlon',
  'blackmores': 'Blackmores',
  'swisse': 'Swisse',
};

export interface ProvinceDef {
  th: string;
  en: string;
  region: string;
}

export const PROVINCES: ProvinceDef[] = [
  // Bangkok & vicinity
  { th: 'กรุงเทพมหานคร', en: 'Bangkok', region: 'กรุงเทพและปริมณฑล' },
  { th: 'นนทบุรี', en: 'Nonthaburi', region: 'กรุงเทพและปริมณฑล' },
  { th: 'ปทุมธานี', en: 'Pathum Thani', region: 'กรุงเทพและปริมณฑล' },
  { th: 'สมุทรปราการ', en: 'Samut Prakan', region: 'กรุงเทพและปริมณฑล' },
  { th: 'สมุทรสาคร', en: 'Samut Sakhon', region: 'กรุงเทพและปริมณฑล' },
  { th: 'นครปฐม', en: 'Nakhon Pathom', region: 'กรุงเทพและปริมณฑล' },
  // Central
  { th: 'พระนครศรีอยุธยา', en: 'Ayutthaya', region: 'ภาคกลาง' },
  { th: 'อ่างทอง', en: 'Ang Thong', region: 'ภาคกลาง' },
  { th: 'ลพบุรี', en: 'Lopburi', region: 'ภาคกลาง' },
  { th: 'สิงห์บุรี', en: 'Sing Buri', region: 'ภาคกลาง' },
  { th: 'ชัยนาท', en: 'Chai Nat', region: 'ภาคกลาง' },
  { th: 'สระบุรี', en: 'Saraburi', region: 'ภาคกลาง' },
  { th: 'นครนายก', en: 'Nakhon Nayok', region: 'ภาคกลาง' },
  { th: 'ปราจีนบุรี', en: 'Prachinburi', region: 'ภาคตะวันออก' },
  { th: 'ฉะเชิงเทรา', en: 'Chachoengsao', region: 'ภาคตะวันออก' },
  { th: 'ชลบุรี', en: 'Chonburi', region: 'ภาคตะวันออก' },
  { th: 'ระยอง', en: 'Rayong', region: 'ภาคตะวันออก' },
  { th: 'จันทบุรี', en: 'Chanthaburi', region: 'ภาคตะวันออก' },
  { th: 'ตราด', en: 'Trat', region: 'ภาคตะวันออก' },
  { th: 'กาญจนบุรี', en: 'Kanchanaburi', region: 'ภาคตะวันตก' },
  { th: 'ราชบุรี', en: 'Ratchaburi', region: 'ภาคตะวันตก' },
  { th: 'สุพรรณบุรี', en: 'Suphan Buri', region: 'ภาคกลาง' },
  { th: 'เพชรบุรี', en: 'Phetchaburi', region: 'ภาคตะวันตก' },
  { th: 'ประจวบคีรีขันธ์', en: 'Prachuap Khiri Khan', region: 'ภาคตะวันตก' },
  { th: 'สมุทรสงคราม', en: 'Samut Songkhram', region: 'ภาคตะวันตก' },
  { th: 'ชัยภูมิ', en: 'Chaiyaphum', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'ขอนแก่น', en: 'Khon Kaen', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'กาฬสินธุ์', en: 'Kalasin', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'มหาสารคาม', en: 'Maha Sarakham', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'ร้อยเอ็ด', en: 'Roi Et', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'นครราชสีมา', en: 'Nakhon Ratchasima', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'บุรีรัมย์', en: 'Buriram', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'สุรินทร์', en: 'Surin', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'ศรีสะเกษ', en: 'Sisaket', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'อุบลราชธานี', en: 'Ubon Ratchathani', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'ยโสธร', en: 'Yasothon', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'อำนาจเจริญ', en: 'Amnat Charoen', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'หนองบัวลำภู', en: 'Nong Bua Lamphu', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'อุดรธานี', en: 'Udon Thani', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'เลย', en: 'Loei', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'หนองคาย', en: 'Nong Khai', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'บึงกาฬ', en: 'Bueng Kan', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'นครพนม', en: 'Nakhon Phanom', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'มุกดาหาร', en: 'Mukdahan', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'สกลนคร', en: 'Sakon Nakhon', region: 'ภาคตะวันออกเฉียงเหนือ' },
  { th: 'เชียงใหม่', en: 'Chiang Mai', region: 'ภาคเหนือ' },
  { th: 'เชียงราย', en: 'Chiang Rai', region: 'ภาคเหนือ' },
  { th: 'แม่ฮ่องสอน', en: 'Mae Hong Son', region: 'ภาคเหนือ' },
  { th: 'พะเยา', en: 'Phayao', region: 'ภาคเหนือ' },
  { th: 'น่าน', en: 'Nan', region: 'ภาคเหนือ' },
  { th: 'แพร่', en: 'Phrae', region: 'ภาคเหนือ' },
  { th: 'ลำปาง', en: 'Lampang', region: 'ภาคเหนือ' },
  { th: 'ลำพูน', en: 'Lamphun', region: 'ภาคเหนือ' },
  { th: 'อุตรดิตถ์', en: 'Uttaradit', region: 'ภาคเหนือ' },
  { th: 'สุโขทัย', en: 'Sukhothai', region: 'ภาคเหนือ' },
  { th: 'พิษณุโลก', en: 'Phitsanulok', region: 'ภาคเหนือ' },
  { th: 'พิจิตร', en: 'Phichit', region: 'ภาคเหนือ' },
  { th: 'เพชรบูรณ์', en: 'Phetchabun', region: 'ภาคเหนือ' },
  { th: 'กำแพงเพชร', en: 'Kamphaeng Phet', region: 'ภาคเหนือ' },
  { th: 'นครสวรรค์', en: 'Nakhon Sawan', region: 'ภาคเหนือ' },
  { th: 'อุทัยธานี', en: 'Uthai Thani', region: 'ภาคเหนือ' },
  { th: 'ตาก', en: 'Tak', region: 'ภาคเหนือ' },
  { th: 'นครศรีธรรมราช', en: 'Nakhon Si Thammarat', region: 'ภาคใต้' },
  { th: 'กระบี่', en: 'Krabi', region: 'ภาคใต้' },
  { th: 'พังงา', en: 'Phang Nga', region: 'ภาคใต้' },
  { th: 'ภูเก็ต', en: 'Phuket', region: 'ภาคใต้' },
  { th: 'สุราษฎร์ธานี', en: 'Surat Thani', region: 'ภาคใต้' },
  { th: 'ระนอง', en: 'Ranong', region: 'ภาคใต้' },
  { th: 'ชุมพร', en: 'Chumphon', region: 'ภาคใต้' },
  { th: 'สงขลา', en: 'Songkhla', region: 'ภาคใต้' },
  { th: 'สตูล', en: 'Satun', region: 'ภาคใต้' },
  { th: 'ตรัง', en: 'Trang', region: 'ภาคใต้' },
  { th: 'พัทลุง', en: 'Phatthalung', region: 'ภาคใต้' },
  { th: 'ปัตตานี', en: 'Pattani', region: 'ภาคใต้' },
  { th: 'ยะลา', en: 'Yala', region: 'ภาคใต้' },
  { th: 'นราธิวาส', en: 'Narathiwat', region: 'ภาคใต้' },
];

const PROVINCE_ALIASES: Record<string, string> = {
  'กทม': 'กรุงเทพมหานคร',
  'กทม.': 'กรุงเทพมหานคร',
  'กรุงเทพ': 'กรุงเทพมหานคร',
  'กรุงเทพฯ': 'กรุงเทพมหานคร',
  'bangkok': 'กรุงเทพมหานคร',
  'bkk': 'กรุงเทพมหานคร',
  'จ.กรุงเทพ': 'กรุงเทพมหานคร',
  'ชลบุรี': 'ชลบุรี',
  'จันทบุรี': 'จันทบุรี',
  'พระนครศรีอยุธยา': 'พระนครศรีอยุธยา',
  'อยุธยา': 'พระนครศรีอยุธยา',
  'ayutthaya': 'พระนครศรีอยุธยา',
  'นครราชสีมา': 'นครราชสีมา',
  'โคราช': 'นครราชสีมา',
  'korat': 'นครราชสีมา',
  'ลำปาง': 'ลำปาง',
};

export interface TaxonomyMatch {
  id: string;
  label: string;
  score: number;
  confidence: number;
}

function matchesKeywords(text: string, keywords: string[]): { score: number; hits: string[] } {
  const hay = text.toLowerCase();
  let score = 0;
  const hits: string[] = [];
  for (const kw of keywords) {
    const needle = kw.toLowerCase();
    if (!needle) continue;
    if (hay.includes(needle)) {
      // คำยาว = เจาะจงกว่า; ภาษาอังกฤษให้คะแนนเต็ม, ไทยให้ตามความยาว
      score += Math.max(2, Math.min(needle.length, 24));
      hits.push(kw);
    }
  }
  return { score, hits };
}

function toMatch(
  scored: { id: string; label: string; score: number }[],
): TaxonomyMatch {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  if (!best || best.score <= 0) {
    return { id: 'other', label: 'Other', score: 0, confidence: 0 };
  }
  const second = sorted[1]?.score ?? 0;
  const margin = best.score / (best.score + second || 1);
  const confidence = Math.round(Math.min(0.98, margin * Math.min(1, best.score / 8)) * 100) / 100;
  return { id: best.id, label: best.label, score: best.score, confidence };
}

export function detectCategory(text: string): TaxonomyMatch {
  const scored = CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    score: matchesKeywords(text, c.keywords).score,
  }));
  return toMatch(scored);
}

const contextHit = (hay: string, terms: readonly string[]): boolean =>
  terms.some((term) => hasAffirmedTerm(hay, term));

/**
 * Rule Override: คำที่เจาะจงกว่าชนะ
 * ------------------------------------------------------------
 * "โต๊ะญี่ปุ่น" เป็นคำ SEO ที่ใช้ได้กับทั้งโต๊ะนั่งพื้นและโต๊ะวางบนเตียง
 * → ต้องดูคำประกอบ (ฟีเจอร์/บริบท) ก่อนตัดสิน product_type
 *
 * น้ำหนัก: บริบทเตียงชัดเจน 3 · บริบทกาแฟ 2 · ฟีเจอร์เตียงอ่อน 1
 * คำที่ถูกปฏิเสธ ("ไม่ปรับระดับ") ไม่นับ — ไม่มีคำประกอบที่ชี้ทาง → คืน null
 * ให้ keyword scoring ปกติ (มักได้ table_generic)
 */
function detectTypeOverride(text: string): TaxonomyMatch | null {
  const hay = String(text ?? '').toLowerCase();
  if (!hay || (!hay.includes('โต๊ะ') && !hay.includes('table'))) return null;

  const hasJpTable = contextHit(hay, JP_TABLE_TERMS);
  const hasStrongBed = contextHit(hay, BED_CONTEXT_TERMS);
  if (!hasJpTable && !hasStrongBed) return null;

  const coffeeScore = hasJpTable && contextHit(hay, COFFEE_CONTEXT_TERMS) ? 2 : 0;
  const bedScore =
    (hasStrongBed ? 3 : 0) +
    (hasJpTable && contextHit(hay, WEAK_BED_FEATURES) ? 1 : 0);

  if (bedScore > coffeeScore && bedScore > 0) {
    return { id: 'bed_desk', label: 'โต๊ะวางบนเตียง', score: 30, confidence: 0.9 };
  }
  if (coffeeScore > bedScore) {
    return { id: 'coffee_table', label: 'โต๊ะกาแฟ', score: 24, confidence: 0.85 };
  }
  return null;
}

export function detectProductType(text: string): TaxonomyMatch {
  const override = detectTypeOverride(text);
  if (override) return override;
  const scored = PRODUCT_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
    score: matchesKeywords(text, t.keywords).score,
  }));
  return toMatch(scored);
}

export function typeCategory(typeId: string): string {
  return PRODUCT_TYPES.find((t) => t.id === typeId)?.category ?? 'other';
}

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Other';
}

export function typeLabel(id: string): string {
  return PRODUCT_TYPES.find((t) => t.id === id)?.label ?? 'Other';
}

export interface BrandMatch {
  brand: string | null;
  confidence: number;
  source: 'spec' | 'name' | 'shop' | 'none';
  evidence?: string;
}

const BRAND_LOOKUP = new Map<string, string>();
for (const b of BRANDS) BRAND_LOOKUP.set(b.toLowerCase(), b);
for (const [alias, canonical] of Object.entries(BRAND_ALIASES)) {
  BRAND_LOOKUP.set(alias.toLowerCase(), canonical);
}
const BRAND_KEYS = [...BRAND_LOOKUP.keys()].sort((a, b) => b.length - a.length);

export function detectBrand(
  name: string,
  specs: { name: string; value: string }[] = [],
  shopName = '',
): BrandMatch {
  // 1) spec ที่ระบุยี่ห้อชัดเจน
  const specBrand = specs.find((s) => /ยี่ห้อ|แบรนด์|brand|สินค้า|ผู้ผลิต/i.test(s.name));
  if (specBrand?.value) {
    const v = specBrand.value.toLowerCase().trim();
    for (const key of BRAND_KEYS) {
      if (v === key || v.startsWith(key + ' ') || v.includes(key)) {
        return { brand: BRAND_LOOKUP.get(key) ?? specBrand.value.trim(), confidence: 0.95, source: 'spec', evidence: specBrand.value };
      }
    }
  }

  const hay = `${name} ${specs.map((s) => s.value).join(' ')}`.toLowerCase();
  // 2) ชื่อสินค้า — ต้องเป็นคำแยก ไม่ใช่ substring กลางคำ
  for (const key of BRAND_KEYS) {
    if (key.length < 3) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(key)}([^\\p{L}\\p{N}]|$)`, 'iu');
    if (re.test(hay)) {
      return { brand: BRAND_LOOKUP.get(key) ?? key, confidence: 0.85, source: 'name', evidence: key };
    }
  }
  // 3) ชื่อร้าน (อย่างระวัง — ร้านทั่วไปอาจตั้งชื่อคล้ายแบรนด์)
  const shop = shopName.toLowerCase();
  for (const key of BRAND_KEYS) {
    if (key.length < 4) continue;
    if (shop.includes(key)) {
      return { brand: BRAND_LOOKUP.get(key) ?? key, confidence: 0.55, source: 'shop', evidence: key };
    }
  }
  return { brand: null, confidence: 0, source: 'none' };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface LocationMatch {
  province: string;
  region: string;
  confidence: number;
}

export function detectProvince(raw?: string | null): LocationMatch {
  if (!raw) return { province: 'ไม่ระบุ', region: 'ไม่ระบุ', confidence: 0 };
  const text = String(raw).trim();
  if (!text) return { province: 'ไม่ระบุ', region: 'ไม่ระบุ', confidence: 0 };
  const cleaned = text.replace(/^จังหวัด/, '').replace(/^จ\./, '').trim().toLowerCase();
  const alias = PROVINCE_ALIASES[cleaned] ?? PROVINCE_ALIASES[cleaned.replace(/\s/g, '')];
  if (alias) {
    const p = PROVINCES.find((x) => x.th === alias);
    if (p) return { province: p.th, region: p.region, confidence: 1 };
  }
  for (const p of PROVINCES) {
    if (cleaned.includes(p.th.toLowerCase())) return { province: p.th, region: p.region, confidence: 1 };
    if (cleaned.includes(p.en.toLowerCase())) return { province: p.th, region: p.region, confidence: 1 };
  }
  // เขตในกรุงเทพฯ
  if (/^เขต/.test(text)) return { province: 'กรุงเทพมหานคร', region: 'กรุงเทพและปริมณฑล', confidence: 0.8 };
  if (/ต่างประเทศ|overseas|จีน|china/i.test(text)) return { province: 'ต่างประเทศ', region: 'ต่างประเทศ', confidence: 0.6 };
  return { province: text, region: 'ไม่ระบุ', confidence: 0.4 };
}

export const MATERIALS: [string, string[]][] = [
  ['ไม้', ['ไม้จริง', 'ไม้ยาง', 'ไม้สัก', 'ไม้โอ๊ค', 'ไม้สน', 'ไม้เนื้อแข็ง', 'wood']],
  ['ไม้อัด/MDF', ['ไม้อัด', 'mdf', 'เมลามีน', 'เมลามีน', 'particle board']],
  ['เหล็ก', ['เหล็ก', 'steel', 'metal', 'โลหะ']],
  ['สแตนเลส', ['สแตนเลส', 'stainless']],
  ['อลูมิเนียม', ['อลูมิเนียม', 'aluminium', 'aluminum']],
  ['พลาสติก', ['พลาสติก', 'plastic', 'pp', 'abs']],
  ['กระจก', ['กระจก', 'glass', 'tempered']],
  ['ผ้า', ['ผ้า', 'fabric', 'linen', 'cotton', 'ผ้าฝ้าย']],
  ['หนัง', ['หนัง', 'leather', 'pu']],
  ['หวาย/ไผ่', ['หวาย', 'ไผ่', 'rattan', 'bamboo']],
  ['หิน/เซรามิก', ['เซรามิก', 'ceramic', 'หินอ่อน', 'marble', 'หิน']],
];

export const COLORS: [string, string[]][] = [
  ['ดำ', ['ดำ', 'black']],
  ['ขาว', ['ขาว', 'white']],
  ['เทา', ['เทา', 'grey', 'gray']],
  ['น้ำตาล', ['น้ำตาล', 'brown', 'walnut', 'โอ๊ค']],
  ['เบจ', ['เบจ', 'beige', 'ครีม', 'cream', 'งาช้าง', 'ivory']],
  ['แดง', ['แดง', 'red']],
  ['น้ำเงิน', ['น้ำเงิน', 'blue', 'navy']],
  ['เขียว', ['เขียว', 'green']],
  ['ชมพู', ['ชมพู', 'pink']],
  ['เหลือง', ['เหลือง', 'yellow']],
  ['ส้ม', ['ส้ม', 'orange']],
  ['เงิน', ['เงิน', 'silver']],
  ['ทอง', ['ทอง', 'gold']],
];

// หมายเหตุ: ห้อง/สไตล์ ย้ายไปอยู่ที่ lib/network/enrich.ts (CONTEXTS, STYLES)
// เพื่อให้มีพจนานุกรมชุดเดียว — ที่นี่เหลือเฉพาะวัสดุ/สี

export function detectFeatureList(
  text: string,
  dict: [string, string[]][],
): string[] {
  const hay = text.toLowerCase();
  const out: string[] = [];
  for (const [label, kws] of dict) {
    if (kws.some((kw) => hay.includes(kw.toLowerCase()))) out.push(label);
  }
  return out;
}
