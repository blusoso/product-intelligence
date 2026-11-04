'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '@/components/icons';
import { nf } from '@/components/network/shared';
import { useApp } from '@/lib/store';
import type { ProductAttribute } from '@/lib/network/types';
import { statusText } from '@/lib/product-row';
import { AttributeLegend, AttributeRows } from './AttributeRows';
import { EditableField } from './EditableField';

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

/** ฟิลด์ที่แก้/บันทึกทีละช่องได้ในแท็บภาพรวม (status ใช้ปุ่มอนุมัติ/ตีกลับ) */
type FieldKey =
  | 'name'
  | 'sku'
  | 'price'
  | 'commission_per_unit'
  | 'product_type'
  | 'brand'
  | 'province'
  | 'description';

const FIELD_ORDER: FieldKey[] = [
  'name',
  'sku',
  'price',
  'commission_per_unit',
  'product_type',
  'brand',
  'province',
  'description',
];

const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'ชื่อสินค้า',
  sku: 'SKU',
  price: 'ราคา',
  commission_per_unit: 'ค่าคอมต่อชิ้น',
  product_type: 'ประเภทสินค้า',
  brand: 'แบรนด์',
  province: 'จังหวัด',
  description: 'คำอธิบาย',
};

/** product row → ค่าที่ใช้เป็น draft ในฟอร์ม (ทุกช่องเป็น string เพื่อให้พิมพ์ได้อิสระ) */
function toDrafts(product: Record<string, any>): Record<FieldKey, string> {
  const text = (v: any) => (v == null ? '' : String(v));
  return {
    name: text(product.name),
    sku: text(product.sku),
    price: text(product.price),
    commission_per_unit: text(product.commission_per_unit),
    product_type: text(product.product_type) || 'other',
    brand: text(product.brand),
    province: text(product.province),
    description: text(product.description),
  };
}

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
  onDirtyChange,
  refreshKey,
}: {
  id: number;
  options: ReviewOptions | null;
  onChanged: () => void;
  onStatus: (status: 'approved' | 'rejected' | 'pending' | 'archived') => void;
  onDelete?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDirtyChange?: (count: number) => void;
  refreshKey?: number;
}) {
  const { showToast } = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [drafts, setDrafts] = useState<Record<FieldKey, string> | null>(null);
  const [savingField, setSavingField] = useState<FieldKey | null>(null);
  const [savedField, setSavedField] = useState<FieldKey | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [attrSaving, setAttrSaving] = useState<string | null>(null);
  const [attrErrors, setAttrErrors] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [raw, setRaw] = useState<any>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const savingRef = useRef<FieldKey | null>(null);
  const attrSavingRef = useRef<string | null>(null);
  const idRef = useRef(id);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    idRef.current = id;
  }, [id]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/products/${id}`, { cache: 'no-store', signal });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'โหลดข้อมูลไม่ได้');
        setDetail(json as Detail);
        setDrafts(toDrafts((json as Detail).product ?? {}));
        setFieldErrors({});
        setSavedField(null);
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
    return () => ctrl.abort();
  }, [load, refreshKey]);

  useEffect(() => {
    setTab('overview');
  }, [id]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const p = detail?.product;

  const dirtyFields = useMemo(() => {
    if (!detail || !drafts) return [] as FieldKey[];
    const product = detail.product;
    return FIELD_ORDER.filter((key) => {
      if (key === 'price' || key === 'commission_per_unit') {
        const draft = String(drafts[key] ?? '').trim();
        const base = product[key] == null ? '' : String(product[key]);
        if (!draft) return Number(base || 0) !== 0;
        return Number(draft) !== Number(base || 0);
      }
      if (key === 'product_type') {
        const draft = String(drafts[key] ?? '') || 'other';
        const base = String(product[key] ?? '') || 'other';
        return draft !== base;
      }
      return String(drafts[key] ?? '').trim() !== String(product[key] ?? '').trim();
    });
  }, [detail, drafts]);

  const dirtySet = useMemo(() => new Set(dirtyFields), [dirtyFields]);
  const dirtyCount = dirtyFields.length;

  useEffect(() => {
    onDirtyChange?.(dirtyCount);
  }, [dirtyCount, onDirtyChange]);

  useEffect(() => {
    if (!dirtyCount) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  const setDraft = (key: FieldKey, value: string) => {
    setDrafts((prev) => (prev ? { ...prev, [key]: value } : prev));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const resetField = (key: FieldKey) => {
    if (!detail) return;
    setDraft(key, toDrafts(detail.product)[key]);
  };

  const onFieldKeyDown = (key: FieldKey) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (dirtySet.has(key)) void saveField(key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetField(key);
    }
  };

  async function saveField(key: FieldKey) {
    if (!detail || !drafts || savingRef.current) return;
    const product = detail.product;
    const rawValue = String(drafts[key] ?? '');
    let value: any = rawValue;
    let fieldError = '';

    if (key === 'name' || key === 'sku') {
      const text = rawValue.trim();
      const max = key === 'name' ? 300 : 120;
      if (!text) fieldError = key === 'name' ? 'ชื่อสินค้าว่างไม่ได้' : 'SKU ว่างไม่ได้';
      else if (text.length > max) fieldError = `${FIELD_LABELS[key]}ยาวเกิน ${max} ตัวอักษร`;
      value = text;
    } else if (key === 'price' || key === 'commission_per_unit') {
      const parsed = rawValue.trim() === '' ? NaN : Number(rawValue);
      const max = key === 'price' ? 10_000_000 : 1_000_000;
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
        fieldError =
          key === 'price'
            ? 'ราคาต้องเป็นตัวเลข 0–10,000,000'
            : 'ค่าคอมต้องเป็นตัวเลข 0–1,000,000';
      } else {
        value = Math.round(parsed * 100) / 100;
      }
    } else if (key === 'brand') {
      const text = rawValue.trim();
      if (text.length > 120) fieldError = 'แบรนด์ยาวเกิน 120 ตัวอักษร';
      value = text || null;
    } else if (key === 'province') {
      const text = rawValue.trim();
      const allowed = new Set((options?.provinces ?? []).map((pr) => pr.th));
      if (text && text !== 'ไม่ระบุ' && allowed.size > 0 && !allowed.has(text)) {
        fieldError = `ไม่รู้จักจังหวัด "${text}"`;
      }
      value = text || null;
    } else if (key === 'description') {
      if (rawValue.length > 4000) fieldError = 'คำอธิบายยาวเกิน 4,000 ตัวอักษร';
      value = rawValue.trim() || null;
    }

    if (fieldError) {
      setFieldErrors((prev) => ({ ...prev, [key]: fieldError }));
      return;
    }

    savingRef.current = key;
    setSavingField(key);
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const startedId = id;

    try {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
      if (idRef.current !== startedId) return;

      const changed: string[] = Array.isArray(json.changed) ? json.changed : [];
      if (changed.length > 0 && json.product) {
        setDetail((d) =>
          d
            ? {
                ...d,
                product: { ...d.product, ...json.product },
                attributes: json.attributes ?? d.attributes,
                counts: json.counts ?? d.counts,
                from_db: json.from_db ?? d.from_db,
                ...(json.ai_meta !== undefined ? { ai_meta: json.ai_meta } : {}),
              }
            : d,
        );
        setDraft(key, toDrafts(json.product)[key]);
        showToast(`บันทึกแล้ว: ${FIELD_LABELS[key]}`);
      } else {
        // ค่าเดิม: server ตอบกลับแค่บางคีย์ จึง sync เฉพาะ draft ไม่แทน product ทั้งก้อน
        setDraft(key, toDrafts(product)[key]);
        showToast('ไม่มีการเปลี่ยนแปลง');
      }

      setSavedField(key);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        setSavedField((current) => (current === key ? null : current));
      }, 2200);
      onChanged();
    } catch (e) {
      if (idRef.current !== startedId) return;
      const message = (e as Error).message;
      setFieldErrors((prev) => ({ ...prev, [key]: message }));
      showToast(`บันทึกไม่สำเร็จ: ${message}`);
    } finally {
      savingRef.current = null;
      setSavingField(null);
    }
  }

  const reload = () => {
    if (dirtyCount && !confirm(`มีการแก้ไขที่ยังไม่บันทึก ${dirtyCount} ช่อง — โหลดใหม่และทิ้งการแก้ไข?`)) {
      return;
    }
    void load();
  };

  const saveAttribute = async (
    attribute: string,
    valueIds: string[],
    note?: string,
  ): Promise<boolean> => {
    if (attrSavingRef.current) return false;
    attrSavingRef.current = attribute;
    setAttrSaving(attribute);
    setAttrErrors((prev) => {
      const next = { ...prev };
      delete next[attribute];
      return next;
    });
    try {
      const res = await fetch(`/api/products/${id}/overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attribute,
          values: valueIds.map((v) => ({ value_id: v })),
          ...(note ? { note } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
      setDetail((d) => (d ? { ...d, attributes: json.attributes, counts: json.counts } : d));
      showToast('บันทึกค่าที่แก้แล้ว');
      onChanged();
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setAttrErrors((prev) => ({ ...prev, [attribute]: message }));
      showToast(`บันทึกไม่สำเร็จ: ${message}`);
      return false;
    } finally {
      attrSavingRef.current = null;
      setAttrSaving(null);
    }
  };

  const clearAttribute = async (attribute: string): Promise<boolean> => {
    if (attrSavingRef.current) return false;
    attrSavingRef.current = attribute;
    setAttrSaving(attribute);
    try {
      const res = await fetch(`/api/products/${id}/overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribute, clear: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'คืนค่าไม่สำเร็จ');
      setDetail((d) => (d ? { ...d, attributes: json.attributes, counts: json.counts } : d));
      setAttrErrors((prev) => {
        const next = { ...prev };
        delete next[attribute];
        return next;
      });
      showToast('คืนค่าเดิมแล้ว');
      onChanged();
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setAttrErrors((prev) => ({ ...prev, [attribute]: message }));
      showToast(`คืนค่าไม่สำเร็จ: ${message}`);
      return false;
    } finally {
      attrSavingRef.current = null;
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
  if (error || !detail || !p || !drafts) {
    return (
      <div className="card">
        <div className="warn">{error ?? 'ไม่พบสินค้า'}</div>
      </div>
    );
  }

  const status = String(p.status ?? 'pending');
  const imgUrl = p.image || p.images_all?.[0] || '';
  const missing = detail.counts.missing_fields;

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
            {dirtyCount ? (
              <span className="tg t-amb" style={{ fontSize: 11 }}>
                ยังไม่บันทึก {dirtyCount} ช่อง
              </span>
            ) : null}
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
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <EditableField
              label="ชื่อสินค้า"
              style={{ flex: '2 1 320px' }}
              dirty={dirtySet.has('name')}
              saving={savingField === 'name'}
              saved={savedField === 'name'}
              disabled={savingField !== null && savingField !== 'name'}
              error={fieldErrors.name}
              onSave={() => void saveField('name')}
              onReset={() => resetField('name')}
            >
              <input
                className="in"
                value={drafts.name}
                onChange={(e) => setDraft('name', e.target.value)}
                onKeyDown={onFieldKeyDown('name')}
                maxLength={300}
                aria-invalid={Boolean(fieldErrors.name)}
              />
            </EditableField>
            <EditableField
              label="SKU"
              style={{ flex: '1 1 120px' }}
              dirty={dirtySet.has('sku')}
              saving={savingField === 'sku'}
              saved={savedField === 'sku'}
              disabled={savingField !== null && savingField !== 'sku'}
              error={fieldErrors.sku}
              onSave={() => void saveField('sku')}
              onReset={() => resetField('sku')}
            >
              <input
                className="in"
                value={drafts.sku}
                onChange={(e) => setDraft('sku', e.target.value)}
                onKeyDown={onFieldKeyDown('sku')}
                maxLength={120}
                aria-invalid={Boolean(fieldErrors.sku)}
              />
            </EditableField>
          </div>

          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <EditableField
              label="ราคา (฿)"
              style={{ flex: '1 1 150px' }}
              dirty={dirtySet.has('price')}
              saving={savingField === 'price'}
              saved={savedField === 'price'}
              disabled={savingField !== null && savingField !== 'price'}
              error={fieldErrors.price}
              onSave={() => void saveField('price')}
              onReset={() => resetField('price')}
            >
              <input
                className="in"
                type="number"
                value={drafts.price}
                onChange={(e) => setDraft('price', e.target.value)}
                onKeyDown={onFieldKeyDown('price')}
                aria-invalid={Boolean(fieldErrors.price)}
              />
            </EditableField>
            <EditableField
              label="ค่าคอมต่อชิ้น (฿)"
              style={{ flex: '1 1 150px' }}
              dirty={dirtySet.has('commission_per_unit')}
              saving={savingField === 'commission_per_unit'}
              saved={savedField === 'commission_per_unit'}
              disabled={savingField !== null && savingField !== 'commission_per_unit'}
              error={fieldErrors.commission_per_unit}
              onSave={() => void saveField('commission_per_unit')}
              onReset={() => resetField('commission_per_unit')}
            >
              <input
                className="in"
                type="number"
                value={drafts.commission_per_unit}
                onChange={(e) => setDraft('commission_per_unit', e.target.value)}
                onKeyDown={onFieldKeyDown('commission_per_unit')}
                aria-invalid={Boolean(fieldErrors.commission_per_unit)}
              />
            </EditableField>
            <EditableField
              label="ประเภทสินค้า"
              style={{ flex: '1 1 200px' }}
              dirty={dirtySet.has('product_type')}
              saving={savingField === 'product_type'}
              saved={savedField === 'product_type'}
              disabled={savingField !== null && savingField !== 'product_type'}
              error={fieldErrors.product_type}
              onSave={() => void saveField('product_type')}
              onReset={() => resetField('product_type')}
            >
              <select
                className="sel"
                value={drafts.product_type}
                onChange={(e) => setDraft('product_type', e.target.value)}
              >
                {options?.product_types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
                <option value="other">อื่น ๆ / ไม่ทราบ</option>
              </select>
            </EditableField>
            <EditableField
              label="จังหวัด"
              style={{ flex: '1 1 180px' }}
              dirty={dirtySet.has('province')}
              saving={savingField === 'province'}
              saved={savedField === 'province'}
              disabled={savingField !== null && savingField !== 'province'}
              error={fieldErrors.province}
              onSave={() => void saveField('province')}
              onReset={() => resetField('province')}
            >
              <select
                className="sel"
                value={drafts.province}
                onChange={(e) => setDraft('province', e.target.value)}
              >
                <option value="">— ไม่ระบุ —</option>
                {options?.provinces.map((pr) => (
                  <option key={pr.th} value={pr.th}>
                    {pr.th}
                  </option>
                ))}
              </select>
            </EditableField>
            <EditableField
              label="แบรนด์"
              style={{ flex: '1 1 180px' }}
              dirty={dirtySet.has('brand')}
              saving={savingField === 'brand'}
              saved={savedField === 'brand'}
              disabled={savingField !== null && savingField !== 'brand'}
              error={fieldErrors.brand}
              onSave={() => void saveField('brand')}
              onReset={() => resetField('brand')}
            >
              <input
                className="in"
                list="brand-options"
                value={drafts.brand}
                onChange={(e) => setDraft('brand', e.target.value)}
                onKeyDown={onFieldKeyDown('brand')}
                maxLength={120}
                placeholder="เว้นว่างได้"
                aria-invalid={Boolean(fieldErrors.brand)}
              />
              <datalist id="brand-options">
                {options?.brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </EditableField>
          </div>

          <EditableField
            label="คำอธิบาย (หลักฐานที่ AI/กติกาใช้อ่าน)"
            dirty={dirtySet.has('description')}
            saving={savingField === 'description'}
            saved={savedField === 'description'}
            disabled={savingField !== null && savingField !== 'description'}
            error={fieldErrors.description}
            hint={`${drafts.description.length.toLocaleString('en-US')} / 4,000 ตัวอักษร`}
            onSave={() => void saveField('description')}
            onReset={() => resetField('description')}
          >
            <textarea
              className="in"
              style={{ height: 120, padding: 12, resize: 'vertical', lineHeight: 1.5 }}
              value={drafts.description}
              onChange={(e) => setDraft('description', e.target.value)}
              maxLength={4000}
              aria-invalid={Boolean(fieldErrors.description)}
            />
          </EditableField>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            {[
              ['ยอดขาย/เดือน', nf.format(Number(p.monthly_sold ?? 0))],
              ['ยอดขายรวม', nf.format(Number(p.historical_sold ?? 0))],
              ['คะแนน', da(p.rating)],
              ['รีวิว', nf.format(Number(p.review_count ?? 0))],
              ['Trust score (Shopee)', p.trust_score != null ? `${p.trust_score}/100` : '—'],
              ['Tier (Shopee)', da(p.tier)],
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
            errors={attrErrors}
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
        {dirtyCount ? (
          <div className="m" style={{ fontSize: 12, color: 'var(--ambT)' }}>
            มี {dirtyCount} ช่องที่ยังไม่บันทึก — กด “บันทึก” ที่ช่องนั้น (Enter เพื่อบันทึก, Esc เพื่อคืนค่า)
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
          <button className="btn gh" onClick={reload} disabled={loading || savingField !== null}>
            <Ic n="refresh" s={16} /> โหลดใหม่
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
