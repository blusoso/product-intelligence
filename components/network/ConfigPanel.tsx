'use client';

import { Ic } from '@/components/icons';
import { nf, TH_DATETIME, type ConfigPreset, type PipelineConfig } from './shared';

const DEDUPE: Array<[PipelineConfig['dedupe'], string, string]> = [
  ['merge', 'รวมรายการซ้ำ', 'เก็บข้อมูลจากทุกครั้งที่ scrape (แนะนำ)'],
  ['keep-richest', 'เก็บตัวที่ข้อมูลครบสุด', 'เหมาะเมื่อรู้ว่าบางรอบ scrape ดีกว่า'],
  ['keep-first', 'เอาตัวแรก', 'ใช้เฉพาะกรณีข้อมูลเรียงตามลำดับที่ต้องการ'],
];

const CANONICAL: Array<[PipelineConfig['canonicalize'], string, string]> = [
  ['off', 'ไม่จัดกลุ่ม', 'ทุก listing เป็นสินค้าแยกกัน'],
  ['evidence', 'ใช้หลักฐาน', 'จัดกลุ่มเมื่อรหัสรุ่นหรือชื่อ+แบรนด์+ขนาดตรงกัน (แนะนำ)'],
  ['propose', 'เสนอเท่านั้น', 'ไม่ลิงก์อัตโนมัติ — เก็บเป็นข้อเสนอให้ตรวจ'],
];

/**
 * เช็คว่า config ปัจจุบัน "ตรงกับ preset ไหน" — เทียบ field ที่สำคัญทุกตัว
 * (เดิมเทียบแค่ 2 fields → preset 'ai_first' ไม่เคยถูก highlight)
 */
function matchesPreset(config: PipelineConfig, preset: PipelineConfig): boolean {
  return (
    config.similarity_threshold === preset.similarity_threshold &&
    config.max_neighbors === preset.max_neighbors &&
    config.edge_min_confidence === preset.edge_min_confidence &&
    config.attribute_overlap_min === preset.attribute_overlap_min &&
    config.ai_min_confidence === preset.ai_min_confidence &&
    config.ai_max_records_per_run === preset.ai_max_records_per_run &&
    config.ai_gate_min_text_fields === preset.ai_gate_min_text_fields &&
    config.ai_focus_ai_only === preset.ai_focus_ai_only &&
    config.phrase_memory === preset.phrase_memory
  );
}

export function ConfigPanel({
  config,
  presets,
  updatedAt,
  saving,
  dirty,
  onChange,
  onSave,
}: {
  config: PipelineConfig;
  presets: ConfigPreset[];
  updatedAt: string | null;
  saving: boolean;
  dirty: boolean;
  onChange: (patch: Partial<PipelineConfig>) => void;
  onSave: () => void;
}) {
  const activePreset = presets.find((p) => matchesPreset(config, p.config));

  return (
    <div className="card">
      <h3>
        <span>ตั้งค่าการประมวลผล</span>
        <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
          {updatedAt ? `บันทึกล่าสุด ${TH_DATETIME(updatedAt)}` : 'ยังไม่เคยบันทึก'}
        </span>
      </h3>

      <div>
        <div className="m" style={{ marginBottom: 8, fontWeight: 700 }}>
          ใช้ค่าสำเร็จรูป
        </div>
        <div className="chs">
          {presets.map((p) => (
            <button
              key={p.id}
              className={`ch ${activePreset?.id === p.id ? 'on' : ''}`}
              onClick={() => onChange(p.config)}
              title={p.description}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* CHANGELOG v2: แสดงคำอธิบายของ preset ที่ active */}
        {activePreset && (
          <span className="m" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
            {activePreset.description}
          </span>
        )}
      </div>

      <div>
        <div className="m" style={{ marginBottom: 8, fontWeight: 700 }}>
          รายการซ้ำ (สินค้าเดียวกันถูกเก็บหลายรอบ)
        </div>
        <div className="chs">
          {DEDUPE.map(([id, label, hint]) => (
            <button
              key={id}
              className={`ch ${config.dedupe === id ? 'on' : ''}`}
              onClick={() => onChange({ dedupe: id })}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="f">
        <span>
          เกณฑ์ความคล้ายของชื่อ: <b>{config.similarity_threshold.toFixed(2)}</b>
        </span>
        <input
          type="range"
          min={0.1}
          max={0.95}
          step={0.01}
          value={config.similarity_threshold}
          onChange={(e) => onChange({ similarity_threshold: Number(e.target.value) })}
        />
        <span className="m" style={{ fontSize: 12 }}>
          สูง = จับคู่น้อยแต่ชัวร์ · ต่ำ = จับคู่เยอะขึ้นแต่มีโอกาสผิด
        </span>
      </label>

      <label className="f">
        <span>
          จำนวนเพื่อนบ้านสูงสุดต่อสินค้า: <b>{config.max_neighbors}</b>
        </span>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={config.max_neighbors}
          onChange={(e) => onChange({ max_neighbors: Number(e.target.value) })}
        />
        <span className="m" style={{ fontSize: 12 }}>
          ยิ่งสูง กราฟยิ่งแน่น แต่ใช้เวลาคำนวณมากขึ้น
        </span>
      </label>

      <label className="f">
        <span>
          เกณฑ์ความมั่นใจขั้นต่ำของแท็กที่ใช้สร้าง edge: <b>{config.edge_min_confidence.toFixed(2)}</b>
        </span>
        <input
          type="range"
          min={0.4}
          max={0.9}
          step={0.05}
          value={config.edge_min_confidence}
          onChange={(e) => onChange({ edge_min_confidence: Number(e.target.value) })}
        />
        <span className="m" style={{ fontSize: 12 }}>
          หลักฐานจากชื่อมักได้ 0.60 · ตั้ง 0.70 ตามเอกสารเข้มจะเหลือคู่ไม่กี่คู่ (ใช้ preset &quot;เข้ม&quot;)
        </span>
      </label>

      <label className="f">
        <span>
          สัดส่วน attribute ที่ต้องทับซ้อน (similar/substitute): <b>{config.attribute_overlap_min.toFixed(2)}</b>
        </span>
        <input
          type="range"
          min={0.3}
          max={0.9}
          step={0.05}
          value={config.attribute_overlap_min}
          onChange={(e) => onChange({ attribute_overlap_min: Number(e.target.value) })}
        />
        <span className="m" style={{ fontSize: 12 }}>
          สูง = ต้องมี use case/บริบท/ฟังก์ชันร่วมกันมากพอ ก่อนนับว่าคล้ายกัน
        </span>
      </label>

      <label className="f">
        <span>
          Trust Gate: อายุข้อมูลสูงสุด (วัน): <b>{config.gate_max_age_days}</b>
        </span>
        <input
          type="range"
          min={1}
          max={90}
          step={1}
          value={config.gate_max_age_days}
          onChange={(e) => onChange({ gate_max_age_days: Number(e.target.value) })}
        />
        <span className="m" style={{ fontSize: 12 }}>
          เกินเกณฑ์ = gate เป็น Review (ไม่ถูกจัดอันดับจนกว่าจะดึงข้อมูลใหม่)
        </span>
      </label>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className={`ch ${config.drop_invalid_identity ? 'on' : ''}`}
          onClick={() => onChange({ drop_invalid_identity: !config.drop_invalid_identity })}
        >
          ตัดรายการที่ไม่มีรหัสสินค้า/ร้าน
        </button>
        <button
          className={`ch ${config.build_similarity ? 'on' : ''}`}
          onClick={() => onChange({ build_similarity: !config.build_similarity })}
        >
          สร้างความสัมพันธ์ระหว่างสินค้า
        </button>
        <button
          className={`ch ${config.variant_nodes ? 'on' : ''}`}
          onClick={() => onChange({ variant_nodes: !config.variant_nodes })}
          title="แสดงตัวเลือก (สี/ขนาด) เป็นโหนด — กราฟจะใหญ่ขึ้นมาก"
        >
          แสดงตัวเลือกเป็นโหนด
        </button>
        <button
          className={`ch ${config.enrich_nodes ? 'on' : ''}`}
          onClick={() => onChange({ enrich_nodes: !config.enrich_nodes })}
          title="แสดง use case / ฟังก์ชัน / บริบท / สไตล์ / พื้นที่ / ช่วงราคา เป็นโหนด"
        >
          แสดงการตีความสินค้าเป็นโหนด
        </button>
      </div>

      <div>
        <div className="m" style={{ marginBottom: 8, fontWeight: 700 }}>
          AI ช่วยสกัด attribute (แยกจากข้อมูลที่ตรวจสอบได้)
        </div>
        <div className="chs">
          <button
            className={`ch ${config.ai_enrich ? 'on' : ''}`}
            onClick={() => onChange({ ai_enrich: !config.ai_enrich })}
            title="ต้องตั้ง AI_API_KEY — AI เลือกค่าได้เฉพาะใน vocabulary และห้ามเดาขนาด/ราคา"
          >
            ใช้ AI
          </button>
          <button
            className={`ch ${config.ai_nodes ? 'on' : ''}`}
            onClick={() => onChange({ ai_nodes: !config.ai_nodes })}
            title="แสดงค่าที่ AI อนุมานเป็นโหนดชนิด ai_attribute (แยกจากโหนดหลักฐาน)"
          >
            แสดงค่า AI เป็นโหนด
          </button>
          <button
            className={`ch ${config.phrase_memory ? 'on' : ''}`}
            onClick={() => onChange({ phrase_memory: !config.phrase_memory })}
            title="ใช้พจนานุกรมวลีที่เรียนรู้จาก quote ของ AI — ต้องสแกนหาวลีในข้อความจริงซ้ำทุกครั้งก่อนใช้"
          >
            ใช้พจนานุกรมวลี
          </button>
          <button
            className={`ch ${config.vision_enrich ? 'on' : ''}`}
            onClick={() => onChange({ vision_enrich: !config.vision_enrich })}
            title="อ่านเฉพาะรูปหน้าปกของแถวที่ข้อความให้ข้อมูลไม่พอ — ใช้ AI_API_KEY ของ DeepSeek ได้"
          >
            อ่านภาพ (VLM)
          </button>
          <button
            className={`ch ${config.ai_focus_ai_only ? 'on' : ''}`}
            onClick={() => onChange({ ai_focus_ai_only: !config.ai_focus_ai_only })}
            title="แถวที่ถูกข้ามเพราะกฎให้ข้อมูลครบ ยังได้ AI เฉพาะค่าที่กฎสร้างไม่ได้ (แพงขึ้นเล็กน้อย)"
          >
            เก็บค่าเฉพาะทางให้แถวที่ข้าม
          </button>
        </div>
        <span className="m" style={{ fontSize: 12 }}>
          AI ไม่มีสิทธิ์เขียนข้อมูลที่วัดได้ (ขนาด/ราคา/ยอดขาย) — ค่าที่ AI ให้จะถูกเก็บแยกใน ai_enrichment
          และค่าที่มาจากภาพต้องมีตำแหน่ง (region/bbox) ทุกค่า
        </span>
      </div>

      <div>
        <div className="m" style={{ marginBottom: 8, fontWeight: 700 }}>
          จัดกลุ่ม listing ที่เป็นสินค้ารุ่นเดียวกัน
        </div>
        <div className="chs">
          {CANONICAL.map(([id, label, hint]) => (
            <button
              key={id}
              className={`ch ${config.canonicalize === id ? 'on' : ''}`}
              onClick={() => onChange({ canonicalize: id })}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="m" style={{ fontSize: 12 }}>
          ไม่มีการลบแถว — เป็นการติดป้ายกลุ่มและเพิ่มเส้น "รุ่นเดียวกัน" เท่านั้น
        </span>
      </div>

      <details>
        <summary className="m" style={{ cursor: 'pointer' }}>
          ตั้งค่าขั้นสูง
        </summary>
        <label className="f" style={{ marginTop: 10 }}>
          <span>จำนวนคู่ที่นำมาเทียบสูงสุด: {nf.format(config.max_pair_candidates)}</span>
          <input
            type="range"
            min={10}
            max={2000}
            step={10}
            value={config.max_pair_candidates}
            onChange={(e) => onChange({ max_pair_candidates: Number(e.target.value) })}
          />
        </label>
        <label className="f">
          <span>
            เกณฑ์ความมั่นใจในการจัดกลุ่ม: <b>{config.canonical_threshold.toFixed(2)}</b>
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={config.canonical_threshold}
            onChange={(e) => onChange({ canonical_threshold: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            สูง = จัดกลุ่มน้อยลงแต่ชัวร์ · ต่ำ = รวมมากขึ้นแต่เสี่ยงผิด
          </span>
        </label>
        <label className="f">
          <span>
            เกณฑ์ความมั่นใจของแท็กที่ตีความ: <b>{config.enrich_min_confidence.toFixed(2)}</b>
          </span>
          <input
            type="range"
            min={0.3}
            max={0.9}
            step={0.05}
            value={config.enrich_min_confidence}
            onChange={(e) => onChange({ enrich_min_confidence: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            สูง = เก็บเฉพาะ use case/บริบทที่หลักฐานชัด · ต่ำ = ได้โหนดมากขึ้นแต่มี noise
          </span>
        </label>
        <label className="f">
          <span>
            เกณฑ์ความมั่นใจของแท็กจาก AI: <b>{config.ai_min_confidence.toFixed(2)}</b>
          </span>
          <input
            type="range"
            min={0.3}
            max={0.95}
            step={0.05}
            value={config.ai_min_confidence}
            onChange={(e) => onChange({ ai_min_confidence: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            AI ที่อ้างคำจริงในข้อความผ่านง่ายกว่า · ค่าที่เป็นการอนุมานต้องมั่นใจสูงกว่านี้
          </span>
        </label>
        <label className="f">
          <span>จำนวนสินค้าที่ส่งให้ AI ต่อรอบ: {config.ai_max_records_per_run}</span>
          {/* CHANGELOG v2: max 1000 → 2000 (ให้ตรงกับ CONFIG_LIMITS ใน config.ts) */}
          <input
            type="range"
            min={10}
            max={2000}
            step={10}
            value={config.ai_max_records_per_run}
            onChange={(e) => onChange({ ai_max_records_per_run: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            จำกัดเพื่อคุมค่าใช้จ่าย — ที่เกินจะถูกข้ามและรายงานไว้ (แนะนำ 500)
          </span>
        </label>
        <label className="f">
          <span>
            ข้าม AI เมื่อกฎให้ข้อมูลครบ:{' '}
            <b>
              {config.ai_gate_min_text_fields === 0
                ? 'ไม่ข้าม'
                : config.ai_gate_min_text_fields === 1
                  ? 'มีอย่างน้อย 1 ฟิลด์'
                  : 'มีทั้งใช้ทำอะไร + ใช้ที่ไหน'}
            </b>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={config.ai_gate_min_text_fields}
            onChange={(e) => onChange({ ai_gate_min_text_fields: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            0 = เรียก AI ทุกแถว · 1 = ข้ามเฉพาะแถวที่ว่างสนิท (แนะนำ) · 2 = ประหยัดสุด (ค่าเดิม)
          </span>
        </label>
        <label className="f">
          <span>จำนวนสินค้าที่ส่งให้ VLM อ่านภาพต่อรอบ: {config.vision_max_records_per_run}</span>
          <input
            type="range"
            min={1}
            max={200}
            step={1}
            value={config.vision_max_records_per_run}
            onChange={(e) => onChange({ vision_max_records_per_run: Number(e.target.value) })}
          />
          <span className="m" style={{ fontSize: 12 }}>
            1 รูป/สินค้า และใช้ cache ตาม URL รูป — รูปเดิมไม่ถูกจ่ายซ้ำ
          </span>
        </label>
      </details>

      <div className="row sp">
        <span className="m" style={{ fontSize: 12 }}>
          {dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'ค่าปัจจุบันถูกบันทึกแล้ว'}
        </span>
        <button className="btn sm" onClick={onSave} disabled={saving || !dirty}>
          <Ic n="chk" s={16} /> {saving ? 'กำลังบันทึก…' : 'บันทึกค่าตั้ง'}
        </button>
      </div>
    </div>
  );
}