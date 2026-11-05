/**
 * Vocabulary กลาง — "ค่ามาตรฐานชุดเดียว" ของทุกสินค้า
 * -----------------------------------------------------
 * CHANGELOG v2 (2026-11-05):
 *  - เพิ่ม max_per_record ของ use_case, function, context, audience เป็น 5
 *  - ลบคำ 'ญี่ปุ่น' ออกจาก style.japanese (กัน SEO Trap)
 */

export type AttrId =
  | 'use_case'
  | 'function'
  | 'context'
  | 'style'
  | 'space'
  | 'audience'
  | 'occasion'
  | 'adjustability'
  | 'power_source'
  | 'assembly'
  | 'finish'
  | 'visual_features'
  | 'material_visual';

export interface VocabValue {
  id: string;
  label: string;
  th: string[];
  en: string[];
  definition: string;
}

export interface AttrDef {
  id: AttrId;
  label: string;
  evidence_capable: boolean;
  max_per_record: number;
  values: VocabValue[];
}

const v = (
  id: string,
  label: string,
  th: string[],
  en: string[],
  definition: string,
): VocabValue => ({ id, label, th, en, definition });

export const ATTRIBUTES: AttrDef[] = [
  {
    id: 'use_case',
    label: 'ใช้ทำอะไร',
    evidence_capable: true,
    max_per_record: 5,
    values: [
      v('reading', 'อ่านหนังสือ', ['อ่านหนังสือ', 'ที่วางหนังสือ'], ['reading', 'book stand'], 'ใช้สำหรับการอ่านหนังสือ'),
      v('desk_work', 'ทำงานโต๊ะ', ['โต๊ะทำงาน', 'ตั้งโต๊ะ', 'ทำงานหน้าคอม'], ['desk setup', 'workstation', 'home office', 'wfh'], 'ใช้ทำงานที่โต๊ะ/หน้าคอมพิวเตอร์'),
      v('study', 'การเรียน', ['เรียน', 'ติว'], ['study'], 'ใช้เพื่อการเรียน/ติว'),
      v('meeting', 'ประชุมออนไลน์', ['ประชุม', 'ออนไลน์', 'zoom', 'meeting', 'webcam', 'ไมค์'], ['meeting', 'video call'], 'ใช้ประชุม/เรียนออนไลน์'),
      v('gaming', 'เล่นเกม', ['เกม', 'เกมมิ่ง', 'gamepad'], ['gaming'], 'ใช้เล่นเกม'),
      v('music', 'ฟังเพลง', ['ฟังเพลง', 'ลำโพง', 'หูฟัง'], ['music', 'speaker', 'headphone'], 'ใช้ฟังเพลง/เสียง'),
      v('cooking', 'ทำอาหาร', ['ทำอาหาร', 'ปรุงอาหาร', 'ครัว'], ['cooking', 'cookware'], 'ใช้ประกอบอาหาร'),
      v('dining', 'รับประทานอาหาร', ['รับประทานอาหาร', 'จานชาม', 'ช้อนส้อม'], ['dining', 'tableware'], 'ใช้รับประทานอาหาร'),
      v('skincare', 'บำรุงผิว', ['บำรุงผิว', 'สกินแคร์', 'ครีมบำรุง', 'ครีมทาหน้า', 'เซรั่ม'], ['skincare', 'serum', 'lotion', 'moisturizer'], 'ใช้บำรุงผิว'),
      v('makeup', 'แต่งหน้า', ['แต่งหน้า', 'เครื่องสำอาง', 'เมคอัพ'], ['makeup', 'cosmetic'], 'ใช้แต่งหน้า'),
      v('grooming', 'ดูแลทรงผม/ใบหน้า', ['ทำผม', 'ไดร์เป่า', 'โกนหนวด', 'โกน', 'แปรงสีฟัน'], ['grooming', 'hair dryer', 'shaver'], 'ใช้ดูแลผม/ใบหน้า'),
      v('fitness', 'ออกกำลังกาย', ['ออกกำลังกาย', 'วิ่ง', 'โยคะ', 'ฟิตเนส'], ['fitness', 'yoga', 'gym'], 'ใช้สำหรับออกกำลังกาย'),
      v('travel', 'เดินทาง', ['เดินทาง', 'ท่องเที่ยว'], ['travel', 'luggage'], 'ใช้พกพาเวลาเดินทาง'),
      v('organizing', 'จัดระเบียบบ้าน', ['จัดเก็บ', 'เก็บของ', 'จัดระเบียบ', 'storage', 'organizer'], ['organizing', 'storage'], 'ใช้จัดเก็บ/จัดระเบียบ'),
      v('decoration', 'ตกแต่งบ้าน', ['ตกแต่ง', 'ของแต่งบ้าน', 'decor', 'decoration', 'ornament'], ['decorating'], 'ใช้ตกแต่ง'),
      v('sleep', 'การนอน', ['ที่นอน', 'หมอน'], ['sleep', 'pillow', 'mattress'], 'ใช้เพื่อการนอน'),
      v('cleaning', 'ทำความสะอาด', ['ทำความสะอาด', 'ไม้ม็อบ', 'cleaning', 'mop'], ['cleaning'], 'ใช้ทำความสะอาด'),
      v('pet_care', 'ดูแลสัตว์เลี้ยง', ['สัตว์เลี้ยง', 'แมว', 'สุนัข', 'pet', 'litter'], ['pet care'], 'ใช้กับสัตว์เลี้ยง'),
      v('baby_care', 'ดูแลเด็ก', ['ทารก', 'แรกเกิด', 'baby'], ['baby care'], 'ใช้กับเด็ก/ทารก'),
    ],
  },
  {
    id: 'function',
    label: 'ทำหน้าที่อะไร',
    evidence_capable: true,
    max_per_record: 5,
    values: [
      v('task_lighting', 'ให้แสงเฉพาะจุด', ['โคมไฟตั้งโต๊ะ', 'ไฟอ่านหนังสือ'], ['desk lamp', 'task light'], 'ให้แสงเฉพาะจุดสำหรับงาน'),
      v('ambient_lighting', 'ให้แสงบรรยากาศ', ['ไฟประดับ', 'ไฟหัวเตียง', 'ไฟกลางคืน'], ['night light', 'ambient', 'led strip'], 'ให้แสงบรรยากาศ/ตกแต่ง'),
      v('lighting', 'ให้แสงสว่าง', ['โคมไฟ', 'โคมระย้า', 'ไฟเพดาน'], ['lamp', 'light bulb'], 'ให้แสงสว่างทั่วไป'),
      v('storage', 'เก็บของ', ['ชั้นวาง', 'ตู้', 'กล่อง', 'ตะกร้า'], ['rack', 'shelf', 'cabinet', 'box'], 'ใช้เก็บของ'),
      v('seating', 'ที่นั่ง', ['เก้าอี้', 'เบาะนั่ง'], ['chair', 'stool'], 'ใช้เป็นที่นั่ง'),
      v('surface', 'พื้นที่วางของ', ['โต๊ะ', 'เคาน์เตอร์'], ['table', 'desk', 'counter'], 'ใช้เป็นพื้นที่วางของ'),
      v('organization', 'จัดระเบียบ', ['ราง', 'ที่เก็บ', 'ตัวแบ่ง'], ['organizer', 'tray', 'divider'], 'ช่วยจัดระเบียบ'),
      v('decoration_role', 'ตกแต่ง', ['ของตกแต่ง', 'โมเดล'], ['decor', 'ornament'], 'ใช้ตกแต่ง'),
      v('protection', 'ปกป้อง/กันเสียหาย', ['กันน้ำ', 'กันรอย', 'กันกระแทก', 'เคส'], ['protective', 'cover'], 'ปกป้องสินค้า/พื้นผิว'),
      v('cleaning_role', 'ทำความสะอาด', ['แปรง', 'น้ำยา'], ['mop', 'brush', 'cleaner'], 'ใช้ทำความสะอาด'),
      v('grooming_role', 'ดูแลร่างกาย', ['ไดร์เป่า', 'เครื่องโกน', 'แปรงแต่งหน้า'], ['dryer', 'shaver'], 'ใช้ดูแลร่างกาย'),
      v('measurement', 'วัดค่า', ['ตาชั่ง', 'ตลับเมตร', 'thermometer'], ['scale', 'measure'], 'ใช้วัดค่า'),
      v('support', 'รองรับ/ตั้ง', ['ขาตั้ง', 'ฐาน', 'ขาโต๊ะ'], ['stand', 'base', 'bracket'], 'รองรับ/ตั้งสินค้า'),
      v('charging', 'ชาร์จไฟ', ['ที่ชาร์จ', 'ชาร์จ'], ['charger', 'power bank'], 'ใช้ชาร์จไฟ'),
      v('cooling', 'ระบายอากาศ', ['พัดลม'], ['cooling', 'fan'], 'ระบายอากาศ/ทำให้เย็น'),
      v('cooking_role', 'ปรุงอาหาร', ['หม้อ', 'กระทะ'], ['pot', 'pan'], 'ใช้ปรุงอาหาร'),
    ],
  },
  {
    id: 'context',
    label: 'ใช้ที่ไหน',
    evidence_capable: true,
    max_per_record: 5,
    values: [
      v('bedroom', 'ห้องนอน', ['ห้องนอน', 'หัวเตียง'], ['bedroom'], 'ใช้ในห้องนอน'),
      v('living_room', 'ห้องนั่งเล่น', ['ห้องนั่งเล่น', 'ห้องรับแขก'], ['living room'], 'ใช้ในห้องนั่งเล่น'),
      v('workspace', 'มุมทำงาน', ['ห้องทำงาน', 'โต๊ะทำงาน', 'ออฟฟิศ'], ['workspace', 'office'], 'ใช้ในมุมทำงาน/ออฟฟิศ'),
      v('study_area', 'มุมอ่านหนังสือ/เรียน', ['มุมอ่านหนังสือ', 'มุมอ่าน', 'โต๊ะอ่านหนังสือ'], ['study area', 'study room', 'มุมเรียน'], 'ใช้ในมุมอ่าน/เรียน'),
      v('kitchen', 'ห้องครัว', ['ห้องครัว', 'เคาน์เตอร์ครัว'], ['kitchen'], 'ใช้ในครัว'),
      v('bathroom', 'ห้องน้ำ', ['ห้องน้ำ'], ['bathroom'], 'ใช้ในห้องน้ำ'),
      v('balcony', 'ระเบียง', ['ระเบียง', 'ดาดฟ้า'], ['balcony'], 'ใช้บนระเบียง'),
      v('cafe', 'ร้านกาแฟ', ['ร้านกาแฟ', 'คาเฟ่'], ['cafe'], 'ใช้ในร้านกาแฟ'),
      v('entryway', 'ทางเข้า/หน้าบ้าน', ['ทางเข้า', 'หน้าบ้าน'], ['entryway', 'hallway'], 'ใช้บริเวณทางเข้า'),
      v('outdoor', 'กลางแจ้ง/สวน', ['กลางแจ้ง', 'สวน'], ['outdoor', 'garden'], 'ใช้กลางแจ้ง'),
      v('car', 'ในรถ', ['ในรถ', 'รถยนต์'], ['car'], 'ใช้ในรถ'),
      v('storage_room', 'ห้องเก็บของ', ['ห้องเก็บของ'], ['storage room'], 'ใช้ในห้องเก็บของ'),
    ],
  },
  {
    id: 'style',
    label: 'สไตล์',
    evidence_capable: true,
    max_per_record: 3,
    values: [
      v('minimal', 'มินิมอล', ['มินิมอล', 'มินิมัล', 'เรียบง่าย'], ['minimal'], 'สไตล์เรียบง่าย'),
      v('modern', 'โมเดิร์น', ['โมเดิร์น', 'ร่วมสมัย'], ['modern', 'contemporary'], 'สไตล์ทันสมัย'),
      v('loft', 'ลอฟท์/อุตสาหกรรม', ['ลอฟท์', 'อุตสาหกรรม'], ['loft', 'industrial'], 'สไตล์ลอฟท์/อุตสาหกรรม'),
      v('scandinavian', 'สแกนดิเนเวียน', ['สแกนดิเนเวียน', 'นอร์ดิก'], ['scandinavian', 'nordic'], 'สไตล์สแกนดิเนเวียน'),
      v('vintage', 'วินเทจ/คลาสสิก', ['วินเทจ', 'คลาสสิก'], ['vintage', 'classic', 'retro'], 'สไตล์วินเทจ/คลาสสิก'),
      v('japanese', 'ญี่ปุ่น/มูจิ', ['มูจิ', 'zen'], ['japanese', 'muji'], 'สไตล์ญี่ปุ่น/มูจิ (ไม่รับ "ญี่ปุ่น" เดี่ยวๆ)'),
      v('luxury', 'หรูหรา', ['หรูหรา', 'พรีเมียม'], ['luxury', 'premium'], 'สไตล์หรูหรา'),
    ],
  },
  {
    id: 'space',
    label: 'เหมาะกับพื้นที่แบบไหน',
    evidence_capable: true,
    max_per_record: 3,
    values: [
      v(
        'small_space',
        'พื้นที่จำกัด',
        ['ประหยัดพื้นที่', 'ประหยัดที่', 'กระทัดรัด', 'กระชับ', 'เล็กกะทัดรัด', 'พับได้', 'ซ้อนได้'],
        ['compact', 'space saving', 'space-saving', 'mini', 'foldable', 'stackable'],
        'เหมาะกับพื้นที่จำกัด',
      ),
      v('wall_mounted', 'ติดผนัง/แขวน', ['ติดผนัง', 'แขวน'], ['wall mount', 'wall-mounted'], 'ติดตั้งบนผนัง/แขวน'),
      v('under_desk', 'วางใต้โต๊ะ', ['ใต้โต๊ะ'], ['under desk', 'under-desk'], 'วางใต้โต๊ะได้'),
      v('portable', 'พกพาได้', ['พกพา'], ['portable'], 'พกพาได้สะดวก'),
    ],
  },
  {
    id: 'audience',
    label: 'กลุ่มผู้ใช้',
    evidence_capable: false,
    max_per_record: 5,
    values: [
      v('student', 'นักเรียน/นักศึกษา', ['นักเรียน', 'นักศึกษา'], ['student'], 'เหมาะกับนักเรียน/นักศึกษา'),
      v('office_worker', 'พนักงานออฟฟิศ', ['พนักงาน', 'ออฟฟิศ'], ['office worker'], 'เหมาะกับคนทำงานออฟฟิศ'),
      v('family', 'ครอบครัว', ['ครอบครัว'], ['family'], 'เหมาะกับครอบครัว'),
      v('renter', 'ผู้เช่าหอ/คอนโด', ['หอพัก', 'คอนโด', 'เช่า'], ['renter', 'condo'], 'เหมาะกับผู้เช่า/ห้องเช่า'),
      v('pet_owner', 'เจ้าของสัตว์เลี้ยง', ['สัตว์เลี้ยง'], ['pet owner'], 'เหมาะกับบ้านที่มีสัตว์เลี้ยง'),
      v('senior', 'ผู้สูงอายุ', ['ผู้สูงอายุ'], ['senior'], 'เหมาะกับผู้สูงอายุ'),
      v('baby', 'เด็กเล็ก/ทารก', ['ทารก', 'เด็กเล็ก'], ['baby', 'toddler'], 'เหมาะกับเด็กเล็ก'),
      v('traveler', 'นักเดินทาง', ['เดินทาง'], ['traveler'], 'เหมาะกับผู้เดินทาง'),
    ],
  },
  {
    id: 'occasion',
    label: 'โอกาสการใช้งาน',
    evidence_capable: false,
    max_per_record: 3,
    values: [
      v('work', 'ทำงาน', ['ทำงาน'], ['work'], 'ใช้ในโอกาสทำงาน'),
      v('study', 'เรียน', ['เรียน'], ['study'], 'ใช้ในโอกาสเรียน'),
      v('relaxation', 'พักผ่อน', ['พักผ่อน'], ['relaxation'], 'ใช้พักผ่อน'),
      v('gift', 'ของขวัญ', ['ของขวัญ'], ['gift'], 'เหมาะเป็นของขวัญ'),
      v('festival', 'เทศกาล', ['เทศกาล', 'ปีใหม่', 'ตรุษจีน'], ['festival'], 'เหมาะกับเทศกาล'),
      v('exercise', 'ออกกำลังกาย', ['ออกกำลังกาย'], ['exercise'], 'ใช้ในโอกาสออกกำลังกาย'),
    ],
  },
  {
    id: 'adjustability',
    label: 'การปรับตั้ง',
    evidence_capable: false,
    max_per_record: 3,
    values: [
      v('height', 'ปรับระดับความสูงได้', ['ปรับระดับ', 'ปรับสูง'], ['height adjustable'], 'ปรับความสูงได้'),
      v('foldable', 'พับเก็บได้', ['พับได้'], ['foldable'], 'พับเก็บได้'),
      v('rotatable', 'หมุน/ปรับมุมได้', ['หมุนได้', 'ปรับมุม'], ['rotatable'], 'หมุนหรือปรับมุมได้'),
      v('stackable', 'วางซ้อนได้', ['ซ้อนได้'], ['stackable'], 'วางซ้อนกันได้'),
      v('none', 'ไม่มีกลไกปรับ', [], ['fixed'], 'ไม่มีกลไกปรับตั้ง'),
    ],
  },
  {
    id: 'power_source',
    label: 'แหล่งพลังงาน',
    evidence_capable: false,
    max_per_record: 2,
    values: [
      v('plug', 'ใช้ปลั๊กไฟ', ['ปลั๊ก', 'เสียบไฟ'], ['plug', 'plug-in'], 'ต้องเสียบปลั๊ก'),
      v('battery', 'ใช้ถ่าน', ['ถ่าน'], ['battery'], 'ใช้ถ่าน'),
      v('usb', 'ชาร์จผ่าน USB', ['usb'], ['usb'], 'ชาร์จผ่าน USB'),
      v('manual', 'ใช้มือ/ไม่ใช้ไฟ', ['ไม่ใช้ไฟ', 'manual'], ['manual', 'no power'], 'ไม่ต้องใช้ไฟ'),
      v('none', 'ไม่เกี่ยวกับไฟ', [], ['none'], 'ไม่มีระบบไฟ'),
    ],
  },
  {
    id: 'assembly',
    label: 'การประกอบ',
    evidence_capable: false,
    max_per_record: 2,
    values: [
      v('ready', 'พร้อมใช้งาน', ['พร้อมใช้'], ['ready to use', 'assembled'], 'ใช้งานได้ทันที'),
      v('flat_pack', 'ประกอบเอง', ['ประกอบเอง', 'ประกอบ'], ['flat pack', 'assembly required'], 'ต้องประกอบเอง'),
      v('partial', 'ประกอบบางส่วน', ['ประกอบบางส่วน'], ['partial assembly'], 'ประกอบบางส่วน'),
    ],
  },
  {
    id: 'finish',
    label: 'ผิว/วัสดุ',
    evidence_capable: false,
    max_per_record: 3,
    values: [
      v('matte', 'ผิวด้าน', ['ผิวด้าน'], ['matte'], 'ผิวด้าน'),
      v('glossy', 'ผิวมัน', ['ผิวมัน'], ['glossy'], 'ผิวมัน'),
      v('wood', 'ลายไม้/ไม้', ['ไม้'], ['wood', 'wooden'], 'วัสดุไม้/ลายไม้'),
      v('fabric', 'ผ้า/สิ่งทอ', ['ผ้า'], ['fabric', 'textile'], 'วัสดุผ้า/สิ่งทอ'),
      v('metal', 'โลหะ', ['เหล็ก', 'โลหะ', 'อลูมิเนียม'], ['metal', 'steel', 'aluminum'], 'วัสดุโลหะ'),
      v('rattan', 'หวาย', ['หวาย'], ['rattan'], 'วัสดุหวาย'),
    ],
  },
  {
    id: 'visual_features',
    label: 'ลักษณะที่เห็นจากภาพ',
    evidence_capable: false,
    max_per_record: 4,
    values: [
      v('tablet_slot', 'ร่องวางแท็บเล็ต/มือถือ', ['ร่องวางแท็บเล็ต', 'ช่องวางมือถือ'], ['tablet slot', 'phone slot'], 'มีร่องหรือช่องสำหรับวางแท็บเล็ต/โทรศัพท์'),
      v('anti_slip_lip', 'ขอบกันลื่น/กันตก', ['ขอบกันลื่น', 'ขอบยก'], ['anti-slip lip', 'raised edge'], 'มีขอบยกขึ้นกันของไถลตก'),
      v('rounded_corners', 'มุมโค้งมน', ['มุมโค้ง', 'เหลี่ยมมน'], ['rounded corners'], 'มุมของสินค้าโค้งมน'),
      v('carrying_handle', 'มีหูหิ้ว/ที่จับ', ['หูหิ้ว', 'ที่จับ'], ['carrying handle', 'handle'], 'มีหูหิ้วหรือที่จับสำหรับยก'),
    ],
  },
  {
    id: 'material_visual',
    label: 'วัสดุที่เห็นจากภาพ',
    evidence_capable: false,
    max_per_record: 3,
    values: [
      v('matte_finish', 'ผิวด้าน', ['ผิวด้าน'], ['matte finish'], 'พื้นผิวด้าน ไม่สะท้อนแสง (เห็นจากภาพ)'),
      v('metal_frame', 'โครงโลหะ', ['โครงเหล็ก', 'โครงโลหะ'], ['metal frame', 'steel frame'], 'เห็นโครงสร้างเป็นโลหะ'),
      v('plastic_tabletop', 'หน้าโต๊ะพลาสติก', ['หน้าพลาสติก'], ['plastic top', 'plastic tabletop'], 'พื้นผิวหลักเป็นพลาสติก'),
    ],
  },
];

export const VISUAL_EQUIVALENTS: Record<string, { attribute: AttrId; value_id: string }> = {
  'material_visual:matte_finish': { attribute: 'finish', value_id: 'matte' },
  'material_visual:metal_frame': { attribute: 'finish', value_id: 'metal' },
};

export const VISUAL_ATTR_IDS: AttrId[] = ['visual_features', 'material_visual'];

export const ATTRIBUTE_MAP: Record<AttrId, AttrDef> = Object.fromEntries(
  ATTRIBUTES.map((a) => [a.id, a]),
) as Record<AttrId, AttrDef>;

export const ATTR_IDS: AttrId[] = ATTRIBUTES.map((a) => a.id);

export function isAttrId(value: unknown): value is AttrId {
  return typeof value === 'string' && (ATTR_IDS as string[]).includes(value);
}

export function valuesOf(attr: AttrId): VocabValue[] {
  return ATTRIBUTE_MAP[attr].values;
}

export function valueIdsOf(attr: AttrId): string[] {
  return valuesOf(attr).map((v2) => v2.id);
}

export function isValidValue(attr: AttrId, valueId: unknown): boolean {
  return typeof valueId === 'string' && valueIdsOf(attr).includes(valueId);
}

export function valueLabel(attr: AttrId, valueId: string): string {
  return valuesOf(attr).find((v2) => v2.id === valueId)?.label ?? valueId;
}

export function keywordValues(attr: AttrId): Array<{ id: string; label: string; keywords: string[] }> {
  return valuesOf(attr).map((v2) => ({ id: v2.id, label: v2.label, keywords: [...v2.th, ...v2.en] }));
}

export function visualEquivalentOf(
  attr: AttrId,
  valueId: string,
): { attribute: AttrId; value_id: string } | null {
  return VISUAL_EQUIVALENTS[`${attr}:${valueId}`] ?? null;
}

export const VOCAB_VERSION = 'vocab-2026-11-05';