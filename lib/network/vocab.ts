/**
 * Vocabulary กลาง — "ค่ามาตรฐานชุดเดียว" ของทุกสินค้า
 * -----------------------------------------------------
 * ใช้ร่วมกันโดย:
 *  - rule engine (lib/network/enrich.ts) → จับคำในชื่อ/สเปก/ตัวเลือก
 *  - AI layer (lib/network/ai.ts) → ส่งเป็นรายการตัวเลือกให้ AI เลือกได้เท่านั้น
 *  - UI / export / audit → ใช้ป้ายไทยชุดเดียวกัน
 *
 * กติกา:
 *  - ทุกค่าต้องมี id (คงที่, ใช้ใน DB/กราฟ) + label (ไทย, ใช้แสดงผล)
 *  - attribute ที่ evidence_capable=false เป็นของ AI เท่านั้น (rule ไม่ตรวจ)
 *  - audience เปิดให้ rule ตรวจเฉพาะ student/kids/baby และคำที่ชัด
 *    (ค่าอื่นยังมาจาก AI) — ดู keyword-registry.ts สำหรับบทบาทของทุกคำ
 *  - ห้ามมี attribute เชิงตัวเลข/การวัด (ขนาด/น้ำหนัก/ราคา/กำลังไฟ) ในชุดนี้
 *    เพราะค่าวัดต้องมาจากการสกัดข้อมูลจริงเท่านั้น
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
  /** rule engine ตรวจด้วยคำค้นได้หรือไม่ */
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
    max_per_record: 4,
    values: [
      v('reading', 'อ่านหนังสือ', ['อ่านหนังสือ'], ['reading'], 'ใช้สำหรับการอ่านหนังสือ'),
      v('desk_work', 'ทำงานโต๊ะ', ['ทำงานหน้าคอม', 'ทำงานที่โต๊ะ'], ['desk work'], 'ใช้ทำงานที่โต๊ะ/หน้าคอมพิวเตอร์'),
      v('study', 'การเรียน', ['เรียน', 'การศึกษา', 'ติว'], ['study'], 'ใช้เพื่อการเรียน/ติว'),
      v('meeting', 'ประชุมออนไลน์', ['ประชุม', 'ประชุมออนไลน์'], ['video call'], 'ใช้ประชุม/เรียนออนไลน์'),
      v('gaming', 'เล่นเกม', ['เล่นเกม', 'เกมมิ่ง'], ['gaming'], 'ใช้เล่นเกม'),
      v('music', 'ฟังเพลง', ['ฟังเพลง', 'ฟังเสียง'], ['music'], 'ใช้ฟังเพลง/เสียง'),
      v('cooking', 'ทำอาหาร', ['ทำอาหาร', 'ปรุงอาหาร'], ['cooking'], 'ใช้ประกอบอาหาร'),
      v('dining', 'รับประทานอาหาร', ['รับประทานอาหาร', 'ทานข้าว'], ['dining'], 'ใช้รับประทานอาหาร'),
      v('skincare', 'บำรุงผิว', ['บำรุงผิว', 'ทาผิว'], ['skincare'], 'ใช้บำรุงผิว'),
      v('makeup', 'แต่งหน้า', ['แต่งหน้า'], ['makeup'], 'ใช้แต่งหน้า'),
      v('grooming', 'ดูแลทรงผม/ใบหน้า', ['ทำผม', 'โกนหนวด'], ['grooming'], 'ใช้ดูแลผม/ใบหน้า'),
      v('fitness', 'ออกกำลังกาย', ['ออกกำลังกาย', 'วิ่ง', 'โยคะ', 'ฟิตเนส'], ['fitness', 'yoga'], 'ใช้สำหรับออกกำลังกาย'),
      v('travel', 'เดินทาง', ['เดินทาง', 'ท่องเที่ยว'], ['travel'], 'ใช้พกพาเวลาเดินทาง'),
      v('organizing', 'จัดระเบียบบ้าน', ['จัดเก็บ', 'เก็บของ', 'จัดระเบียบ'], ['organizing'], 'ใช้จัดเก็บ/จัดระเบียบ'),
      v('decoration', 'ตกแต่งบ้าน', ['ตกแต่ง', 'ตกแต่งบ้าน'], ['decorating'], 'ใช้ตกแต่ง'),
      v('sleep', 'การนอน', ['นอนหลับ'], ['sleep'], 'ใช้เพื่อการนอน'),
      v('cleaning', 'ทำความสะอาด', ['ทำความสะอาด'], ['cleaning'], 'ใช้ทำความสะอาด'),
      v('pet_care', 'ดูแลสัตว์เลี้ยง', ['ดูแลสัตว์เลี้ยง', 'ให้อาหารสัตว์'], ['pet care'], 'ใช้กับสัตว์เลี้ยง'),
      v('baby_care', 'ดูแลเด็ก', ['ดูแลเด็ก'], ['baby care'], 'ใช้กับเด็ก/ทารก'),
      v('writing', 'เขียนหนังสือ', ['เขียนหนังสือ'], ['writing'], 'ใช้สำหรับการเขียนหนังสือ'),
    ],
  },
  {
    id: 'function',
    label: 'ทำหน้าที่อะไร',
    evidence_capable: true,
    max_per_record: 4,
    values: [
      v('task_lighting', 'ให้แสงเฉพาะจุด', ['ให้แสงเฉพาะจุด', 'ส่องสว่างเฉพาะจุด'], ['task lighting'], 'ให้แสงเฉพาะจุดสำหรับงาน'),
      v('ambient_lighting', 'ให้แสงบรรยากาศ', ['ให้แสงบรรยากาศ', 'แสงบรรยากาศ'], ['ambient lighting'], 'ให้แสงบรรยากาศ/ตกแต่ง'),
      v('lighting', 'ให้แสงสว่าง', ['ให้แสงสว่าง'], ['lighting'], 'ให้แสงสว่างทั่วไป'),
      v('storage', 'เก็บของ', ['เก็บของ', 'จัดเก็บ'], ['storage'], 'ใช้เก็บของ'),
      v('seating', 'ที่นั่ง', ['ที่นั่ง', 'ใช้เป็นที่นั่ง'], ['seating'], 'ใช้เป็นที่นั่ง'),
      v('surface', 'พื้นที่วางของ', ['พื้นที่วางของ'], ['surface'], 'ใช้เป็นพื้นที่วางของ'),
      v('organization', 'จัดระเบียบ', ['จัดระเบียบ'], ['organization'], 'ช่วยจัดระเบียบ'),
      v('decoration_role', 'ตกแต่ง', ['ตกแต่ง'], ['decorating'], 'ใช้ตกแต่ง'),
      v('protection', 'ปกป้อง/กันเสียหาย', ['กันน้ำ', 'กันรอย', 'กันกระแทก'], ['protective'], 'ปกป้องสินค้า/พื้นผิว'),
      v('cleaning_role', 'ทำความสะอาด', ['ทำความสะอาด'], ['cleaning'], 'ใช้ทำความสะอาด'),
      v('grooming_role', 'ดูแลร่างกาย', ['ดูแลร่างกาย'], ['grooming'], 'ใช้ดูแลร่างกาย'),
      v('measurement', 'วัดค่า', ['วัดค่า'], ['measure'], 'ใช้วัดค่า'),
      v('support', 'รองรับ/ตั้ง', ['รองรับ'], ['support'], 'รองรับ/ตั้งสินค้า'),
      v('charging', 'ชาร์จไฟ', ['ชาร์จไฟ', 'ชาร์จ'], ['charging'], 'ใช้ชาร์จไฟ'),
      v('cooling', 'ระบายอากาศ', ['ระบายอากาศ'], ['cooling'], 'ระบายอากาศ/ทำให้เย็น'),
      v('cooking_role', 'ปรุงอาหาร', ['ปรุงอาหาร'], ['cooking'], 'ใช้ปรุงอาหาร'),
    ],
  },
  {
    id: 'context',
    label: 'ใช้ที่ไหน',
    evidence_capable: true,
    max_per_record: 3,
    values: [
      v('bedroom', 'ห้องนอน', ['ห้องนอน'], ['bedroom'], 'ใช้ในห้องนอน'),
      v('living_room', 'ห้องนั่งเล่น', ['ห้องนั่งเล่น', 'ห้องรับแขก'], ['living room'], 'ใช้ในห้องนั่งเล่น'),
      v('workspace', 'มุมทำงาน', ['ห้องทำงาน', 'มุมทำงาน', 'ออฟฟิศ'], ['workspace', 'office', 'home office', 'wfh'], 'ใช้ในมุมทำงาน/ออฟฟิศ'),
      v('study_area', 'มุมอ่านหนังสือ/เรียน', ['มุมอ่านหนังสือ', 'มุมอ่าน', 'มุมเรียน'], ['study area', 'study room'], 'ใช้ในมุมอ่าน/เรียน'),
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
      v('minimal', 'มินิมอล', ['เรียบง่าย'], [], 'สไตล์เรียบง่าย'),
      v('modern', 'โมเดิร์น', ['โมเดิร์น', 'ร่วมสมัย'], ['modern', 'contemporary'], 'สไตล์ทันสมัย'),
      v('loft', 'ลอฟท์/อุตสาหกรรม', ['ลอฟท์', 'อุตสาหกรรม'], ['loft', 'industrial'], 'สไตล์ลอฟท์/อุตสาหกรรม'),
      v('scandinavian', 'สแกนดิเนเวียน', ['สแกนดิเนเวียน', 'นอร์ดิก'], ['scandinavian', 'nordic'], 'สไตล์สแกนดิเนเวียน'),
      v('vintage', 'วินเทจ/คลาสสิก', ['วินเทจ', 'คลาสสิก'], ['vintage', 'classic', 'retro'], 'สไตล์วินเทจ/คลาสสิก'),
      v('japanese', 'ญี่ปุ่น/มูจิ', ['zen'], ['zen'], 'สไตล์ญี่ปุ่น/มูจิ'),
      v('luxury', 'หรูหรา', [], [], 'สไตล์หรูหรา (AI/แมนนวลเท่านั้น)'),
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
        ['ประหยัดพื้นที่', 'ประหยัดที่', 'กระทัดรัด', 'กระชับ', 'เล็กกะทัดรัด'],
        ['compact', 'space saving', 'space-saving'],
        'เหมาะกับพื้นที่จำกัด',
      ),
      v('wall_mounted', 'ติดผนัง/แขวน', ['ติดผนัง', 'แขวน'], ['wall mount', 'wall-mounted'], 'ติดตั้งบนผนัง/แขวน'),
      v('under_desk', 'วางใต้โต๊ะ', ['ใต้โต๊ะ'], ['under desk', 'under-desk'], 'วางใต้โต๊ะได้'),
      v('portable', 'พกพาได้', ['พกพา', 'พกพาสะดวก'], ['portable'], 'พกพาได้สะดวก'),
    ],
  },
  {
    id: 'audience',
    label: 'กลุ่มผู้ใช้',
    evidence_capable: true,
    max_per_record: 3,
    values: [
      v('student', 'นักเรียน/นักศึกษา', ['นักเรียน', 'นักศึกษา'], ['student'], 'เหมาะกับนักเรียน/นักศึกษา'),
      v('office_worker', 'พนักงานออฟฟิศ', ['พนักงาน', 'พนักงานออฟฟิศ'], ['office worker'], 'เหมาะกับคนทำงานออฟฟิศ'),
      v('family', 'ครอบครัว', ['ครอบครัว'], ['family'], 'เหมาะกับครอบครัว'),
      v('renter', 'ผู้เช่าหอ/คอนโด', ['ผู้เช่า', 'ห้องเช่า'], ['renter'], 'เหมาะกับผู้เช่า/ห้องเช่า'),
      v('pet_owner', 'เจ้าของสัตว์เลี้ยง', ['เจ้าของสัตว์เลี้ยง'], ['pet owner'], 'เหมาะกับบ้านที่มีสัตว์เลี้ยง'),
      v('senior', 'ผู้สูงอายุ', ['ผู้สูงอายุ'], ['senior'], 'เหมาะกับผู้สูงอายุ'),
      v('baby', 'เด็กเล็ก/ทารก', ['ทารก', 'เด็กเล็ก'], ['baby', 'toddler'], 'เหมาะกับเด็กเล็ก'),
      v('kids', 'เด็ก', ['เด็ก', 'สำหรับเด็ก'], ['kid', 'kids'], 'เหมาะกับเด็กโต/เด็กทั่วไป'),
      v('traveler', 'นักเดินทาง', ['นักเดินทาง'], ['traveler'], 'เหมาะกับผู้เดินทาง'),
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
      v('height', 'ปรับระดับความสูงได้', ['ปรับระดับ', 'ปรับสูง', 'ปรับความสูง'], ['height adjustable'], 'ปรับความสูงได้'),
      v('foldable', 'พับเก็บได้', ['พับได้', 'พับเก็บได้', 'พับเก็บ', 'ขาพับ'], ['foldable', 'folding'], 'พับเก็บได้'),
      v('rotatable', 'หมุน/ปรับมุมได้', ['หมุนได้', 'ปรับมุม', 'ปรับองศา'], ['rotatable'], 'หมุนหรือปรับมุมได้'),
      v('stackable', 'วางซ้อนได้', ['ซ้อนได้'], ['stackable'], 'วางซ้อนกันได้'),
      v('none', 'ไม่มีกลไกปรับ', ['ไม่มีกลไกปรับ'], ['fixed'], 'ไม่มีกลไกปรับตั้ง'),
    ],
  },
  {
    id: 'power_source',
    label: 'แหล่งพลังงาน',
    evidence_capable: false,
    max_per_record: 2,
    values: [
      v('plug', 'ใช้ปลั๊กไฟ', ['ปลั๊ก', 'เสียบปลั๊ก', 'เสียบไฟ'], ['plug', 'plug-in'], 'ต้องเสียบปลั๊ก'),
      v('battery', 'ใช้ถ่าน', ['ถ่าน', 'ใช้ถ่าน'], ['battery'], 'ใช้ถ่าน'),
      v('usb', 'ชาร์จผ่าน USB', ['usb', 'ชาร์จ usb'], ['usb'], 'ชาร์จผ่าน USB'),
      v('manual', 'ใช้มือ/ไม่ใช้ไฟ', ['ไม่ใช้ไฟ', 'ไม่ต้องใช้ไฟ'], ['manual', 'no power'], 'ไม่ต้องใช้ไฟ'),
      v('none', 'ไม่เกี่ยวกับไฟ', ['ไม่เกี่ยวกับไฟ'], ['none'], 'ไม่มีระบบไฟ'),
    ],
  },
  {
    id: 'assembly',
    label: 'การประกอบ',
    evidence_capable: false,
    max_per_record: 2,
    values: [
      v('ready', 'พร้อมใช้งาน', ['พร้อมใช้', 'ประกอบเสร็จ', 'ไม่ต้องประกอบ'], ['ready to use', 'assembled'], 'ใช้งานได้ทันที'),
      v('flat_pack', 'ประกอบเอง', ['ประกอบเอง', 'ต้องประกอบ'], ['flat pack', 'assembly required'], 'ต้องประกอบเอง'),
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
      v('wood', 'ลายไม้/ไม้', [], [], 'วัสดุไม้/ลายไม้ (AI/แมนนวลเท่านั้น)'),
      v('fabric', 'ผ้า/สิ่งทอ', [], [], 'วัสดุผ้า/สิ่งทอ (AI/แมนนวลเท่านั้น)'),
      v('metal', 'โลหะ', [], [], 'วัสดุโลหะ (AI/แมนนวลเท่านั้น)'),
      v('rattan', 'หวาย', [], [], 'วัสดุหวาย (AI/แมนนวลเท่านั้น)'),
    ],
  },
  /**
   * ลักษณะทางกายภาพที่ "เห็นได้จากภาพ" แต่ข้อความมักไม่บอก
   * → rule engine ไม่ตรวจ (evidence_capable=false) เก็บได้เฉพาะ AI ที่อ่านภาพ
   */
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

/**
 * ค่า "เห็นจากภาพ" ที่ซ้ำความหมายกับ attribute ที่ตรวจได้จากข้อความ
 * → ถ้ามีค่าฝั่ง finish อยู่แล้ว ไม่เก็บซ้ำเป็น material_visual
 */
export const VISUAL_EQUIVALENTS: Record<string, { attribute: AttrId; value_id: string }> = {
  'material_visual:matte_finish': { attribute: 'finish', value_id: 'matte' },
  'material_visual:metal_frame': { attribute: 'finish', value_id: 'metal' },
};

/** ค่าที่มาจากภาพเท่านั้น (ใช้ตัดสินว่าต้องส่ง VLM ไหม / ตรวจ allowlist ของ vision) */
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

/** ใช้โดย rule engine: แปลง vocab ของ attribute หนึ่งเป็นรายการคำค้น */
export function keywordValues(attr: AttrId): Array<{ id: string; label: string; keywords: string[] }> {
  return valuesOf(attr).map((v2) => ({ id: v2.id, label: v2.label, keywords: [...v2.th, ...v2.en] }));
}

/** ถ้าค่าที่เห็นจากภาพซ้ำกับค่าที่ข้อความตรวจได้ → คืนคู่ที่ควรใช้แทน */
export function visualEquivalentOf(
  attr: AttrId,
  valueId: string,
): { attribute: AttrId; value_id: string } | null {
  return VISUAL_EQUIVALENTS[`${attr}:${valueId}`] ?? null;
}

export const VOCAB_VERSION = 'vocab-2026-11-04.2';
