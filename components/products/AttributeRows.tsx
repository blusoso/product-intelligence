'use client';

import { useState } from 'react';
import { Ic } from '@/components/icons';
import type { AttributeSource, ProductAttribute } from '@/lib/network/types';

const SOURCE_STYLE: Record<string, { label: string; style: React.CSSProperties }> = {
  manual: {
    label: 'คนแก้',
    style: { border: '1.5px solid var(--lilT)', background: 'var(--lil)', color: 'var(--lilT)' },
  },
  evidence: { label: 'หลักฐาน', style: { background: 'var(--soft)', color: 'var(--ink)' } },
  computed: {
    label: 'คำนวณ',
    style: { border: '1px solid var(--line)', background: 'transparent', color: 'var(--mute)' },
  },
  ai_inferred: {
    label: 'AI',
    style: { border: '1px dashed #B05BD0', background: 'transparent', color: '#8B3FAE' },
  },
};

const STATUS_TEXT: Record<string, string> = {
  evidence: 'จากข้อความ',
  computed: 'คำนวณ',
  ai: 'AI อนุมาน',
  mixed: 'ผสม',
  manual: 'คนแก้',
  none: 'ยังไม่มีข้อมูล',
};

export function SourceChip({ source }: { source: string }) {
  const s = SOURCE_STYLE[source] ?? { label: source, style: {} };
  return (
    <span className="tg" style={{ fontSize: 11, padding: '1px 7px', ...s.style }}>
      {s.label}
    </span>
  );
}

export function AttributeLegend() {
  return (
    <div className="m" style={{ fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <span><SourceChip source="evidence" /> ตรวจสอบได้จากข้อความ</span>
      <span><SourceChip source="computed" /> คำนวณจากตัวเลข/กฎ</span>
      <span><SourceChip source="ai_inferred" /> AI อนุมาน (แยกจากหลักฐาน)</span>
      <span><SourceChip source="manual" /> คนแก้ — ใช้แทนค่าอื่นของช่องนั้น</span>
    </div>
  );
}

function valueTitle(a: ProductAttribute, v: { source: AttributeSource; confidence: number; grounded?: boolean; conflict?: boolean; evidence_type?: 'text' | 'image'; ai_model?: string; evidence?: string[] }) {
  const fromImage = v.source === 'ai_inferred' && v.evidence_type === 'image';
  return [
    `ที่มา: ${SOURCE_STYLE[v.source]?.label ?? v.source} · ความมั่นใจ ${Math.round((v.confidence ?? 0) * 100)}%`,
    v.source === 'ai_inferred'
      ? `${fromImage ? 'อ่านจากภาพ (มีตำแหน่ง)' : v.grounded ? 'อ้างคำจริงในข้อความ' : 'อนุมานเอง'}${
          v.conflict ? ' · ขัดกับหลักฐาน' : ''
        }${v.ai_model ? ` · ${v.ai_model}` : ''}`
      : '',
    ...(v.evidence ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * ตาราง attribute มาตรฐานทั้งหมด (ลำดับคงที่จาก ATTRIBUTE_DEFS)
 * - editable: แสดงปุ่มแก้/คืนค่า (เฉพาะ attribute ที่มีใน vocab)
 * - onSave / onClear: เรียก API แล้วให้ parent โหลดใหม่
 */
export function AttributeRows({
  attributes,
  vocab,
  onSave,
  onClear,
  saving,
  errors,
}: {
  attributes: ProductAttribute[];
  vocab?: Record<string, Array<{ id: string; label: string }>>;
  onSave?: (attribute: string, valueIds: string[], note?: string) => Promise<boolean> | void;
  onClear?: (attribute: string) => Promise<boolean> | void;
  saving?: string | null;
  errors?: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const locked = Boolean(busy || saving);

  const startEdit = (a: ProductAttribute) => {
    if (locked) return;
    if (open === a.attribute) {
      setOpen(null);
      return;
    }
    setOpen(a.attribute);
    setPicked(a.values.filter((v) => v.source === 'manual' || v.source === 'evidence').map((v) => v.value_id));
    setNote('');
  };

  const submit = async (a: ProductAttribute) => {
    if (locked || !picked.length) return;
    setBusy(a.attribute);
    try {
      const ok = await onSave?.(a.attribute, picked, note.trim() || undefined);
      if (ok !== false) {
        setOpen(null);
        setPicked([]);
        setNote('');
      }
    } finally {
      setBusy(null);
    }
  };

  const clear = async (a: ProductAttribute) => {
    if (locked) return;
    setBusy(a.attribute);
    try {
      await onClear?.(a.attribute);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tbl" style={{ minWidth: 0 }}>
      {attributes.map((a) => {
        const list = vocab?.[a.attribute];
        const editable = Boolean(list && onSave);
        const isOpen = open === a.attribute;
        return (
          <div
            key={a.attribute}
            className="tr"
            style={{
              gridTemplateColumns: 'minmax(150px,190px) 1fr',
              alignItems: 'start',
              paddingTop: 8,
              paddingBottom: 8,
              gap: 12,
            }}
          >
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{a.label}</b>
              <span className="m" style={{ display: 'block', fontSize: 11 }}>
                {a.attribute} · {STATUS_TEXT[a.status] ?? a.status}
                {a.overridden ? ' · แทนที่ค่าอัตโนมัติ' : ''}
              </span>
            </span>

            <span style={{ minWidth: 0, display: 'grid', gap: 6 }}>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {a.values.length === 0 ? <span className="m">— ยังไม่มีข้อมูล</span> : null}
                {a.values.map((v, i) => (
                  <span
                    key={`${v.value_id}-${v.source}-${i}`}
                    className="tg"
                    style={{
                      gap: 6,
                      border: v.source === 'ai_inferred' ? '1px dashed #B05BD0'
                        : v.source === 'manual' ? '1.5px solid var(--lilT)'
                        : '1px solid transparent',
                      background: v.source === 'ai_inferred' ? 'transparent'
                        : v.source === 'manual' ? 'var(--lil)'
                        : 'var(--soft)',
                      color: v.source === 'ai_inferred' ? '#8B3FAE' : v.source === 'manual' ? 'var(--lilT)' : 'var(--ink)',
                    }}
                    title={valueTitle(a, v)}
                  >
                    {v.source === 'ai_inferred' ? 'AI ' : v.source === 'manual' ? 'คนแก้ ' : ''}
                    {v.label}
                    {v.source !== 'manual' ? (
                      <span style={{ opacity: 0.6, fontWeight: 500 }}>{Math.round((v.confidence ?? 0) * 100)}%</span>
                    ) : null}
                  </span>
                ))}
                {editable ? (
                  <button
                    className="btn sm gh"
                    style={{ height: 26, padding: '0 10px', fontSize: 12 }}
                    onClick={() => startEdit(a)}
                    disabled={locked}
                  >
                    {saving === a.attribute ? 'กำลังบันทึก…' : a.overridden ? 'แก้ค่า' : 'แก้ไข'}
                  </button>
                ) : null}
                {a.overridden && onClear ? (
                  <button
                    className="btn sm gh"
                    style={{ height: 26, padding: '0 10px', fontSize: 12 }}
                    onClick={() => void clear(a)}
                    disabled={locked}
                    title="ลบค่าที่คนแก้ แล้วกลับไปใช้ค่าที่ระบบคำนวณไว้"
                  >
                    คืนค่าเดิม
                  </button>
                ) : null}
                {a.superseded ? (
                  <span className="m" style={{ fontSize: 11 }}>
                    (แทนที่ {a.superseded} ค่าเดิม)
                  </span>
                ) : null}
              </span>

              {errors?.[a.attribute] ? (
                <span role="alert" style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad)' }}>
                  {errors[a.attribute]}
                </span>
              ) : null}

              {isOpen && list ? (
                <div
                  style={{
                    background: 'var(--bg)',
                    borderRadius: 14,
                    padding: 12,
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div className="chs" style={{ gap: 6 }}>
                    {list.map((v) => {
                      const on = picked.includes(v.id);
                      return (
                        <button
                          key={v.id}
                          type="button"
                          className={'ch ' + (on ? 'on' : '')}
                          style={{ height: 30, fontSize: 13 }}
                          onClick={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id]))}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    className="in"
                    style={{ height: 38, background: 'var(--card)' }}
                    placeholder="หมายเหตุ (ไม่บังคับ) เช่น “อ่านจากรูป/สอบถามร้านแล้ว”"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn sm"
                      disabled={!picked.length || locked}
                      onClick={() => void submit(a)}
                    >
                      {busy === a.attribute ? 'กำลังบันทึก…' : 'บันทึกค่านี้'}
                    </button>
                    <button className="btn sm gh" onClick={() => setOpen(null)} disabled={busy === a.attribute}>
                      ยกเลิก
                    </button>
                    <span className="m" style={{ fontSize: 12 }}>
                      เลือกได้จากรายการที่ระบบรู้จักเท่านั้น (กันการพิมพ์ค่าเดา)
                    </span>
                  </div>
                </div>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AttributesEmpty({ note }: { note?: string }) {
  return (
    <div className="m" style={{ padding: 20, textAlign: 'center' }}>
      <Ic n="file" s={18} /> {note ?? 'ยังไม่มีข้อมูล attribute'}
    </div>
  );
}
