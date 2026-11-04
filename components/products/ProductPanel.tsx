'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ic } from '@/components/icons';
import { nf } from '@/components/network/shared';
import { useApp } from '@/lib/store';
import type { ProductAttribute } from '@/lib/network/types';
import { statusText } from '@/lib/product-row';
import { AttributeLegend, AttributeRows } from './AttributeRows';

export interface ReviewOptions {
  product_types: Array<{ id: string; label: string; category: string }>;
  brands: string[];
  provinces: Array<{ th: string; region: string }>;
  attributes: Array<{ id: string; label: string; kind: string }>;
  vocab: Record<string, Array<{ id: string; label: string }>>;
}

interface Counts {
  attributes_filled: number;
  ai_values: number;
  verified_values: number;
  overridden: number;
  missing_fields: string[];
}

interface Detail {
  product: Record<string, any>;
  attributes: ProductAttribute[];
  from_db: boolean;
  counts: Counts;
  ai_meta: Record<string, any> | null;
  raw?: any;
}

type Tab = 'overview' | 'attributes' | 'ai' | 'raw';

const STATUS_TONE: Record<string, string> = {
  pending: 't-amb',
  approved: 't-lime',
  rejected: 't-bad',
  archived: 't-mut',
};

const da = (v: any) => (v == null || v === '' ? '—' : String(v));

export function ProductPanel({
  id,
  options,
  onChanged,
  onStatus,
  onDelete,
  onPrev,
  onNext,
}: {
  id: number;
  options: ReviewOptions | null;
  onChanged: () => void;
  onStatus: (status: 'approved' | 'rejected' | 'pending' | 'archived') => void;
  onDelete?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const { showToast } = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [attrSaving, setAttrSaving] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [raw, setRaw] = useState<any>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/products/${id}`, { cache: 'no-store', signal });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'โหลดข้อมูลไม่ได้');
        setDetail(json as Detail);
        const p = json.product ?? {};
        setForm({
          name: p.name ?? '',
          sku: p.sku ?? '',
          price: p.price ?? '',
          commission_per_unit: p.commission_per_unit ?? '',
          product_type: p.product_type ?? 'other',
          brand: p.brand ?? '',
          province: p.province ?? '',
          description: p.description ?? '',
          status: p.status ?? 'pending',
        });
        setRaw(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    setTab('overview');
    return () => ctrl.abort();
  }, [load]);

  const p = detail?.product;
  const dirty = useMemo(() => {
    if (!p) return false;
    return (
      String(form.name ?? '') !== String(p.name ?? '') ||
      String(form.sku ?? '') !== String(p.sku ?? '') ||
      Number(form.price ?? 0) !== Number(p.price ?? 0) ||
      Number(form.commission_per_unit ?? 0) !== Number(p.commission_per_unit ?? 0) ||
      String(form.product_type ?? '') !== String(p.product_type ?? '') ||
      String(form.brand ?? '') !== String(p.brand ?? '') ||
      String(form.province ?? '') !== String(p.province ?? '') ||
      String(form.description ?? '') !== String(p.description ?? '')
    );
  }, [form, p]);

  const save = async () => {
    if (!p || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          sku: form.sku,
          price: Number(form.price),
          commission_per_unit: Number(form.commission_per_unit),
          product_type: form.product_type,
          brand: form.brand || null,
          province: form.province || null,
          description: form.description,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
      setDetail((d) => (d ? { ...d, product: json.product, attributes: json.attributes, counts: json.counts, from_db: json.from_db } : d));
      showToast(json.changed?.length ? `บันทึกแล้ว ${json.changed.length} ช่อง` : 'ไม่มีอะไรเปลี่ยนแปลง');
      onChanged();
    } catch (e) {
      showToast(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveAttribute = async (attribute: string, valueIds: string[]) => {
    setAttrSaving(attribute);
    try {
      const res = await fetch(`/api/products/${id}/overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribute, values: valueIds.map((v) => ({ value_id: v })) }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
      setDetail((d) => (d ? { ...d, attributes: json.attributes, counts: json.counts } : d));
      showToast('บันทึกค่าที่แก้แล้ว');
      onChanged();
    } catch (e) {
      showToast(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setAttrSaving(null);
    }
  };

  const clearAttribute = async (attribute: string) => {
    setAttrSaving(attribute);
    try {
      const res = await fetch(`/api/products/${id}/overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribute, clear: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'คืนค่าไม่สำเร็จ');
      setDetail((d) => (d ? { ...d, attributes: json.attributes, counts: json.counts } : d));
      showToast('คืนค่าเดิมแล้ว');
      onChanged();
    } catch (e) {
      showToast(`คืนค่าไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setAttrSaving(null);
    }
  };

  const rerunAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch(`/api/products/${id}/enrich-ai`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'เรียก AI ไม่สำเร็จ');
      await load();
      showToast(`AI ให้ ${json.tags?.length ?? 0} ค่า — ตรวจในแท็บ AI`);
    } catch (e) {
      showToast(`เรียก AI ไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  const openRaw = async () => {
    setTab('raw');
    if (raw || rawLoading) return;
    setRawLoading(true);
    try {
      const res = await fetch(`/api/products/${id}?include=raw`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'โหลดข้อมูลดิบไม่ได้');
      setRaw(json.raw ?? null);
    } catch (e) {
      showToast(`โหลดข้อมูลดิบไม่ได้: ${(e as Error).message}`);
    } finally {
      setRawLoading(false);
    }
  };

  if (loading && !detail) {
    return (
      <div className="card">
        <div className="m">กำลังโหลดรายละเอียด…</div>
      </div>
    );
  }
  if (error || !detail || !p) {
    return (
      <div className="card">
        <div className="warn">{error ?? 'ไม่พบสินค้า'}</div>
      </div>
    );
  }

  const status = String(p.status ?? 'pending');
  const imgUrl = p.image || p.images_all?.[0] || '';
  const missing = detail.counts.missing_fields;
  const productTypeLabel = options?.product_types.find((t) => t.id === form.product_type)?.label ?? form.product_type;

  return (
    <div className="card" style={{ gap: 14 }}>
      {/* ── หัว: รูป + ชื่อ + สถานะ ── */}
      <div style={{ display: 'flex', gap: 14 }}>
        <div
          style={{
            width: 92,
            height: 92,
            flexShrink: 0,
            borderRadius: 16,
            overflow: 'hidden',
            background: 'var(--bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Ic n="box" s={26} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={`tg ${STATUS_TONE[status] ?? 't-mut'}`}>{statusText(status)}</span>
            <span className="m" style={{ fontSize: 12 }}>
              {p.plat === 'tiktok' ? 'TikTok' : 'Shopee'} · {da(p.shop_name)}
            </span>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className="m" style={{ fontSize: 12 }}>
                <Ic n="link" s={12} /> เปิดหน้าสินค้า
              </a>
            ) : null}
          </div>
          <b style={{ display: 'block', fontSize: 16, marginTop: 6, lineHeight: 1.35 }}>{p.name}</b>
          <div className="m" style={{ fontSize: 12, marginTop: 4 }}>
            {da(p.sku)} · {da(p.ext)}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className="tg t-mut">attribute {detail.counts.attributes_filled}/18</span>
            <span className="tg t-lut t-mut">ตรวจสอบได้ {detail.counts.verified_values}</span>
            <span className="tg t-mut">AI {detail.counts.ai_values}</span>
            {detail.counts.overridden ? <span className="tg t-lil">คนแก้ {detail.counts.overridden}</span> : null}
            {p.quality_score != null ? (
              <span
                className="tg"
                style={{
                  background: p.quality_score >= 80 ? 'var(--okS)' : 'var(--amb)',
                  color: p.quality_score >= 80 ? 'var(--okT)' : 'var(--ambT)',
                }}
              >
                คุณภาพ {p.quality_score}
              </span>
            ) : null}
          </div>
        </div>
        <div className="row" style={{ gap: 6, alignSelf: 'flex-start' }}>
          {onPrev ? (
            <button className="ib sq" onClick={onPrev} title="รายการก่อนหน้า (k)">
              ↑
            </button>
          ) : null}
          {onNext ? (
            <button className="ib sq" onClick={onNext} title="รายการถัดไป (j)">
              ↓
            </button>
          ) : null}
        </div>
      </div>

      {/* ── แท็บ ── */}
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {(
          [
            ['overview', 'ภาพรวม'],
            ['attributes', `Attributes ${detail.counts.attributes_filled}/18`],
            ['ai', 'AI'],
            ['raw', 'ข้อมูลดิบ'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? 'on' : ''}
            onClick={() => (k === 'raw' ? openRaw() : setTab(k))}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── ภาพรวม ── */}
      {tab === 'overview' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="f" style={{ flex: '2 1 320px' }}>
              ชื่อสินค้า
              <input className="in" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={300} />
            </label>
            <label className="f" style={{ flex: '1 1 120px' }}>
              SKU
              <input className="in" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} maxLength={120} />
            </label>
          </div>

          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="f" style={{ flex: '1 1 150px' }}>
              ราคา (฿)
              <input className="in" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </label>
            <label className="f" style={{ flex: '1 1 150px' }}>
              ค่าคอมต่อชิ้น (฿)
              <input
                className="in"
                type="number"
                value={form.commission_per_unit}
                onChange={(e) => setForm({ ...form, commission_per_unit: e.target.value })}
              />
            </label>
            <label className="f" style={{ flex: '1 1 200px' }}>
              ประเภทสินค้า
              <select
                className="sel"
                value={form.product_type}
                onChange={(e) => setForm({ ...form, product_type: e.target.value })}
              >
                {options?.product_types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
                <option value="other">อื่น ๆ / ไม่ทราบ</option>
              </select>
            </label>
            <label className="f" style={{ flex: '1 1 180px' }}>
              จังหวัด
              <select className="sel" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {options?.provinces.map((pr) => (
                  <option key={pr.th} value={pr.th}>
                    {pr.th}
                  </option>
                ))}
              </select>
            </label>
            <label className="f" style={{ flex: '1 1 180px' }}>
              แบรนด์
              <input
                className="in"
                list="brand-options"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                maxLength={120}
                placeholder="เว้นว่างได้"
              />
              <datalist id="brand-options">
                {options?.brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="f">
            คำอธิบาย (หลักฐานที่ AI/กติกาใช้อ่าน)
            <textarea
              className="in"
              style={{ height: 120, padding: 12, resize: 'vertical', lineHeight: 1.5 }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={4000}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            {[
              ['ยอดขาย/เดือน', nf.format(Number(p.monthly_sold ?? 0))],
              ['ยอดขายรวม', nf.format(Number(p.historical_sold ?? 0))],
              ['คะแนน', da(p.rating)],
              ['รีวิว', nf.format(Number(p.review_count ?? 0))],
              ['ความน่าเชื่อถือ', p.trust_score != null ? `${p.trust_score}/100` : '—'],
              ['ระดับ', da(p.tier)],
              ['สต็อก', p.in_stock === false ? 'หมด' : da(p.total_stock ?? 'มี')],
              ['อายุ listing', p.listing_age_days != null ? `${p.listing_age_days} วัน` : '—'],
              ['ขนาด', da(p.size_label)],
              ['หมวดที่ระบบจัด', `${da(p.product_type)} · ${(Number(p.category_confidence ?? 0) * 100).toFixed(0)}%`],
              ['นำเข้าล่าสุด', p.ingested_at ? new Date(p.ingested_at).toLocaleString('th-TH') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg)', borderRadius: 14, padding: '8px 12px' }}>
                <div className="m" style={{ fontSize: 11 }}>
                  {k}
                </div>
                <b style={{ fontSize: 14 }}>{v}</b>
              </div>
            ))}
          </div>

          {Array.isArray(p.quality_flags) && p.quality_flags.length ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="m" style={{ fontSize: 12 }}>ธงคุณภาพ:</span>
              {p.quality_flags.map((f: string) => (
                <span key={f} className="tg t-amb" style={{ fontSize: 11 }}>{f}</span>
              ))}
            </div>
          ) : null}

          {Array.isArray(p.specs) && p.specs.length ? (
            <details>
              <summary className="m" style={{ cursor: 'pointer', fontSize: 13 }}>
                สเปกที่ร้านระบุ ({p.specs.length})
              </summary>
              <div className="tbl" style={{ marginTop: 8 }}>
                {p.specs.slice(0, 40).map((s: any, i: number) => (
                  <div key={i} className="tr" style={{ gridTemplateColumns: '200px 1fr', minHeight: 36 }}>
                    <span className="m" style={{ fontSize: 13 }}>{s.name}</span>
                    <span style={{ fontSize: 13 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* ── Attributes ── */}
      {tab === 'attributes' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="m" style={{ fontSize: 12 }}>
            ชุดมาตรฐาน 18 ช่องที่ทุกสินค้าใช้เหมือนกัน
            {detail.from_db ? '' : ' · แถวนี้ยังไม่เคยประมวลผล จึงคำนวณสดจากข้อมูลที่มี'}
          </div>
          <AttributeLegend />
          <AttributeRows
            attributes={detail.attributes}
            vocab={options?.vocab}
            onSave={saveAttribute}
            onClear={clearAttribute}
            saving={attrSaving}
          />
        </div>
      ) : null}

      {/* ── AI ── */}
      {tab === 'ai' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 14, display: 'grid', gap: 6 }}>
            <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
              <b style={{ fontSize: 14 }}>ข้อมูลที่ AI สร้าง</b>
              <button className="btn sm gh" onClick={rerunAi} disabled={aiBusy}>
                <Ic n="bolt" s={14} /> {aiBusy ? 'กำลังเรียก…' : 'เรียก AI ใหม่เฉพาะรายการนี้'}
              </button>
            </div>
            {detail.ai_meta ? (
              <div className="m" style={{ fontSize: 12 }}>
                {da(detail.ai_meta.provider)}/{da(detail.ai_meta.model)} · {da(detail.ai_meta.status)} ·{' '}
                {detail.ai_meta.at ? new Date(detail.ai_meta.at).toLocaleString('th-TH') : '—'}
                {detail.ai_meta.error ? ` · ${detail.ai_meta.error}` : ''}
              </div>
            ) : (
              <div className="m" style={{ fontSize: 12 }}>
                ยังไม่มีข้อมูล AI ของรายการนี้ — กด “เรียก AI ใหม่เฉพาะรายการนี้” เพื่อสร้าง
              </div>
            )}
            <div className="m" style={{ fontSize: 12 }}>
              ค่าจาก AI ถูกเก็บแยกจากหลักฐานเสมอ · ‘อ้างคำจริง’ = มีข้อความยืนยัน · ‘อนุมาน’ = AI เดาเอง (ความมั่นใจ ≤ 60%)
            </div>
          </div>

          <div className="tbl">
            {detail.attributes
              .flatMap((a) =>
                a.values
                  .filter((v) => v.source === 'ai_inferred')
                  .map((v) => ({ a, v })),
              )
              .map(({ a, v }, i) => (
                <div key={`${a.attribute}-${v.value_id}-${i}`} className="tr" style={{ gridTemplateColumns: '150px 1fr 110px', minHeight: 44 }}>
                  <span className="m" style={{ fontSize: 12 }}>{a.label}</span>
                  <span>
                    <b style={{ fontSize: 13 }}>{v.label}</b>
                    {v.evidence?.[0] ? (
                      <span className="m" style={{ display: 'block', fontSize: 12 }}>
                        “{v.evidence[0]}”
                      </span>
                    ) : null}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`tg ${v.grounded ? 't-ok' : 't-mut'}`} style={{ fontSize: 11 }}>
                      {v.evidence_type === 'image' ? 'อ่านจากภาพ' : v.grounded ? 'อ้างคำจริง' : 'อนุมาน'}
                    </span>
                    {v.conflict ? <span className="tg t-bad" style={{ fontSize: 11 }}>ขัด</span> : null}
                  </span>
                </div>
              ))}
            {detail.counts.ai_values === 0 ? <div className="m" style={{ padding: 16 }}>ยังไม่มีค่าจาก AI</div> : null}
          </div>
        </div>
      ) : null}

      {/* ── ข้อมูลดิบ ── */}
      {tab === 'raw' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className="m" style={{ fontSize: 12 }}>ข้อมูลดิบที่ scraper ส่งเข้ามา (raw_products.payload) — ต้นทางของทุกค่า</div>
          {rawLoading ? <div className="m">กำลังโหลด…</div> : null}
          {raw ? (
            <pre className="code" style={{ maxHeight: 420 }}>
              {JSON.stringify(raw, null, 2)}
            </pre>
          ) : !rawLoading ? (
            <div className="m">ไม่มี payload ดิบของรายการนี้</div>
          ) : null}
        </div>
      ) : null}

      {/* ── ท้าย: บันทึก / อนุมัติ ── */}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 10 }}>
        {missing.length ? (
          <div className="m" style={{ fontSize: 12, color: 'var(--ambT)' }}>
            ยังขาดข้อมูลที่ควรมี: {missing.join(' · ')} — อนุมัติได้ แต่คุณภาพข้อมูลจะต่ำ
          </div>
        ) : null}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn gh"
            style={{ color: 'var(--bad)', boxShadow: 'inset 0 0 0 1.5px var(--line)' }}
            onClick={() => onStatus('rejected')}
          >
            <Ic n="trash" s={16} /> ตีกลับ
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn gh" onClick={() => load()} disabled={saving || loading}>
            <Ic n="refresh" s={16} /> โหลดใหม่
          </button>
          <button className="btn" onClick={save} disabled={!dirty || saving} style={{ opacity: dirty ? 1 : 0.55 }}>
            {saving ? 'กำลังบันทึก…' : dirty ? 'บันทึกการแก้ไข' : 'บันทึกแล้ว'}
          </button>
          <button
            className="btn"
            style={{ background: 'var(--ok)', color: '#fff' }}
            onClick={() => onStatus('approved')}
            disabled={status === 'approved'}
          >
            <Ic n="chk" s={16} /> อนุมัติ
          </button>
          {onDelete ? (
            <button className="btn gh" style={{ color: 'var(--bad)' }} onClick={onDelete} title="ลบสินค้ารายการนี้">
              <Ic n="trash" s={16} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
