'use client';

import { Ic } from '@/components/icons';
import type { StepId } from './shared';

export interface StepDef {
  id: StepId;
  title: string;
  hint: string;
  done: boolean;
}

export function StepBar({
  steps,
  active,
  onSelect,
  blocked,
}: {
  steps: StepDef[];
  active: StepId;
  onSelect: (id: StepId) => void;
  blocked?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))`,
        gap: 8,
      }}
    >
      {steps.map((s) => {
        const on = s.id === active;
        const disabled = blocked && s.id > 1;
        return (
          <button
            key={s.id}
            onClick={() => !disabled && onSelect(s.id)}
            disabled={disabled}
            style={{
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: 20,
              background: on ? 'var(--ink)' : 'var(--card)',
              color: on ? 'var(--bg)' : 'var(--ink)',
              boxShadow: on ? 'none' : 'var(--shadow)',
              opacity: disabled ? 0.55 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '.03em',
                opacity: on ? 0.75 : 0.6,
              }}
            >
              {s.done ? <Ic n="chk" s={14} c={on ? 'var(--lime)' : 'var(--ok)'} /> : `ขั้น ${s.id}`}
            </span>
            <b style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.title}
            </b>
            <span style={{ fontSize: 12, color: on ? 'var(--bg)' : 'var(--mute)', opacity: on ? 0.7 : 1 }}>
              {s.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
