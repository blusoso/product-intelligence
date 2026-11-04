'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '@/components/icons';
import { useApp } from '@/lib/store';
import { ATTRIBUTE_MAP, type AttrId } from '@/lib/network/vocab';
import { nf, TH_DATETIME } from './shared';

interface ConflictRowView {
  id: number;
  ext: string;
  name?: string;
  product_id?: number;
  attribute: string;
  value_id: string;
  value_label: string;
  rule_values: string[];
  ai_confidence: number;
  ai_quote: string | null;
  evidence_type: 'text' | 'image';
  severity: 'warning' | 'critical';
  reason: string;
  status: string;
  created_at: string;
}

interface Payload {
  ok: boolean;
  error?: string;
  store?: string;
  counts?: { pending: number; critical: number };
  rows: ConflictRowView[];
}

const labelOf = (attribute: string, valueId: string) => {
  const def = ATTRIBUTE_MAP[attribute as AttrId];
  if (!def) return valueId;
  return def.values.find((v) => v.id === valueId)?.label ?? valueId;
};

/**
 * คิวตรวจ "ค่าที่ AI ให้ขัดกับหลักฐาน"
 * - ระบบยึดหลักฐานเป็นตัวจริงเสมอ จนกว่าคนจะตัดสิน
 * - accept_ai = เขียน attribute_overrides (manual ชนะทุกชั้น, pipeline ไม่เขียนทับ)
 */
export function ConflictQueue() {
  const { showToast } = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/network/conflicts?status=pending&limit=100', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
      if (!json.ok) throw new Error(json.error ?? 'โหลดคิวไม่สำเร็จ');
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = useCallback(async () => {
    setBusy('scan');
    try {
      const res = await fetch('/api/network/conflicts/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'สแกนไม่สำเร็จ');
      showToast(
        `สแกน ${nf.format(json.scanned ?? 0)} สินค้า — เปิดใหม่ ${nf.format(json.opened ?? 0)} · ปิดอัตโนมัติ ${nf.format(json.closed ?? 0)}`,
      );
      await load();
    } catch (e) {
      showToast(`สแกนไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [load, showToast]);

  const resolve = useCallback(
    async (row: ConflictRowView, action: 'accept_rule' | 'accept_ai' | 'dismiss') => {
      const key = `${row.ext}|${row.attribute}|${row.value_id}`;
      setBusy(key);
      try {
        const res = await fetch('/api/network/conflicts/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ext: row.ext, attribute: row.attribute, value_id: row.value_id, action }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
        showToast(
          action === 'accept_ai'
            ? `ยืนยันค่า AI แล้ว — เขียนเป็นค่าที่คนแก้ (${labelOf(row.attribute, row.value_id)})`
            : action === 'accept_rule'
              ? 'ยึดหลักฐานเป็นตัวจริงแล้ว'
              : 'ปิดรายการนี้แล้ว',
        );
        await load();
      } catch (e) {
        showToast(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [load, showToast],
  );

  const rows = data?.rows ?? [];
  const pending = data?.counts?.pending ?? rows.length;
  const critical = data?.counts?.critical ?? rows.filter((r) => r.severity === 'critical').length;

  if (!error && !rows.length) {
    return (
      <div className="card" style={{ gap: 6, padding: '14px 18px', borderRadius: 22 }}>
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>ขัดแย้งรอตรวจ</b>
            <span className="tg t-lime">ไม่มีรายการค้าง</span>
            <span className="m">ค่าที่ AI ให้สอดคล้องกับหลักฐานทั้งหมด</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm gh" onClick={() => void scan()} disabled={busy === 'scan'} title="สแกนความขัดแย้งใหม่จากข้อมูลที่เก็บไว้ (ไม่เรียก AI)">
              <Ic n="search" s={15} /> {busy === 'scan' ? 'กำลังสแกน…' : 'สแกนใหม่'}
            </button>
            <button className="btn sm gh" onClick={() => void load()} title="โหลดคิวใหม่">
              <Ic n="refresh" s={15} /> รีเฟรช
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ gap: 8 }}>
      <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>ขัดแย้งรอตรวจ</b>
          <span className={`tg ${critical ? 't-bad' : pending ? 't-amb' : 't-lime'}`}>
            {nf.format(pending)} รายการ{critical ? ` · สำคัญ ${nf.format(critical)}` : ''}
          </span>
          <span className="m">
            ระบบยึดหลักฐานเป็นตัวจริง — ค่าที่ AI ให้จะไม่ถูกใช้จนกว่าคนจะยืนยัน
            {data?.store === 'file' ? ' · บันทึกแบบไฟล์ (ยังไม่ได้ apply migration)' : ''}
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm gh" onClick={() => void scan()} disabled={busy === 'scan'} title="สแกนความขัดแย้งใหม่จากข้อมูลที่เก็บไว้ (ไม่เรียก AI)">
            <Ic n="search" s={15} /> {busy === 'scan' ? 'กำลังสแกน…' : 'สแกนใหม่'}
          </button>
          <button className="btn sm gh" onClick={() => void load()} title="โหลดคิวใหม่">
            <Ic n="refresh" s={15} /> รีเฟรช
          </button>
        </div>
      </div>

      {error ? (
        <div className="m" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map((row) => {
          const key = `${row.ext}|${row.attribute}|${row.value_id}`;
          const ruleText = row.rule_values.length
            ? row.rule_values.map((v) => labelOf(row.attribute, v)).join(', ')
            : '— (ไม่มีค่าจากหลักฐาน)';
          return (
            <div
              key={key}
              className="row sp"
              style={{
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                padding: '8px 10px',
                border: '1px solid var(--line, #eee)',
                borderRadius: 14,
              }}
            >
              <div style={{ display: 'grid', gap: 2, flex: '1 1 320px', minWidth: 0 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className={`tg ${row.severity === 'critical' ? 't-bad' : 't-amb'}`}>
                    {row.severity === 'critical' ? 'สำคัญ' : 'ควรดู'}
                  </span>
                  <b style={{ fontSize: 13 }}>{ATTRIBUTE_MAP[row.attribute as AttrId]?.label ?? row.attribute}</b>
                  <span className="tg t-lil">AI: {row.value_label || labelOf(row.attribute, row.value_id)}</span>
                  <span className="tg t-mut">หลักฐาน: {ruleText}</span>
                  {row.evidence_type === 'image' ? <span className="tg t-mut">จากภาพ</span> : null}
                  <span className="m">{Math.round(row.ai_confidence * 100)}%</span>
                </div>
                <span className="m" style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.name || row.ext}
                  {row.reason ? ` · ${row.reason}` : ''}
                  {row.ai_quote ? ` · อ้าง: “${row.ai_quote}”` : ''}
                </span>
                <span className="m" style={{ fontSize: 11 }}>
                  {TH_DATETIME(row.created_at)}
                </span>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn sm gh"
                  disabled={busy === key}
                  onClick={() => void resolve(row, 'accept_rule')}
                  title="ยึดค่าที่มีหลักฐานเป็นตัวจริง (ไม่เขียนทับข้อมูล)"
                >
                  ยึดหลักฐาน
                </button>
                <button
                  className="btn sm gh"
                  disabled={busy === key}
                  onClick={() => void resolve(row, 'accept_ai')}
                  title="ยืนยันค่า AI — เขียนเป็น attribute override (คนแก้) เพื่อไม่ให้ pipeline เขียนทับ"
                >
                  ยืนยันค่า AI
                </button>
                <button
                  className="btn sm gh"
                  disabled={busy === key}
                  onClick={() => void resolve(row, 'dismiss')}
                  title="ปิดรายการนี้โดยไม่เปลี่ยนค่า"
                >
                  ไม่ใช่ปัญหา
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
