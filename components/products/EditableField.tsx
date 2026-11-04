'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Ic } from '@/components/icons';

/**
 * เปลือกของ field ที่บันทึกทีละช่อง
 * - label + input (children) + แถวปุ่ม/สถานะ
 * - ไม่ถือ state เอง ผู้เรียกเก็บ draft/dirty/saving/error แล้วส่งกลับมา
 */
export function EditableField({
  label,
  children,
  error,
  dirty = false,
  saving = false,
  saved = false,
  disabled = false,
  onSave,
  onReset,
  hint,
  style,
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
  dirty?: boolean;
  saving?: boolean;
  saved?: boolean;
  disabled?: boolean;
  onSave: () => void;
  onReset: () => void;
  hint?: string;
  style?: CSSProperties;
}) {
  const locked = saving || disabled;

  return (
    <div className="f" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...style }}>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--mute)',
        }}
      >
        <span>{label}</span>
        {children}
      </label>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', minHeight: 26 }}>
        <button
          type="button"
          className="btn sm"
          style={{ height: 26, padding: '0 10px', fontSize: 12, opacity: dirty && !locked ? 1 : 0.55 }}
          onClick={onSave}
          disabled={!dirty || locked}
        >
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
        {dirty ? (
          <button
            type="button"
            className="btn sm gh"
            style={{ height: 26, padding: '0 10px', fontSize: 12 }}
            onClick={onReset}
            disabled={locked}
          >
            คืนค่า
          </button>
        ) : null}
        {saved && !dirty ? (
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--okT)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Ic n="chk" s={12} /> บันทึกแล้ว
          </span>
        ) : null}
        {error ? (
          <span role="alert" style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad)' }}>
            {error}
          </span>
        ) : null}
      </div>
      {hint && !error ? (
        <span className="m" style={{ fontSize: 11 }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
