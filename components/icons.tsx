import React from 'react';
const P = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
  pen: <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></>,
  chk: <><path d="M20 6 9 17l-5-5"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></>,
  bolt: <><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></>,
  warn: <><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></>,
  nodes: <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.1 15.8 6.6M7.3 8.2l3.8 7.3M16.7 9.1l-3.5 6.5"/></>,
  down: <><path d="M12 4v12m-5-5 5 5 5-5M4 20h16"/></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
} as const;
export type IconName = keyof typeof P;
export function Ic({ n, s = 20, c = 'currentColor' }: { n: IconName; s?: number; c?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {P[n]}
    </svg>
  );
}

export const ART = {
  lamp: <><circle cx="60" cy="50" r="46" fill="#FFF1E2" opacity=".8"/><path d="M38 30h44l10 34H28z" fill="#FF8F5E"/><rect x="57" y="64" width="6" height="34" rx="3" fill="#15182E"/><ellipse cx="60" cy="102" rx="22" ry="6" fill="#15182E"/></>,
  mat: <><rect x="14" y="40" width="92" height="46" rx="12" fill="#15182E" transform="rotate(-6 60 60)"/><rect x="26" y="52" width="40" height="8" rx="4" fill="#C8F560" transform="rotate(-6 60 60)"/></>,
  stand: <><rect x="22" y="38" width="76" height="14" rx="6" fill="#6C5CE7"/><rect x="30" y="52" width="10" height="34" rx="4" fill="#15182E"/><rect x="80" y="52" width="10" height="34" rx="4" fill="#15182E"/></>,
  serum: <><rect x="44" y="40" width="32" height="52" rx="10" fill="#15182E"/><rect x="52" y="24" width="16" height="18" rx="5" fill="#C8F560"/><rect x="50" y="56" width="20" height="18" rx="5" fill="#fff" opacity=".9"/></>,
  tote: <><path d="M38 50h44l6 44H32z" fill="#FF8F5E"/><path d="M46 50c0-16 28-16 28 0" fill="none" stroke="#15182E" strokeWidth="5" strokeLinecap="round"/></>,
} as const;

export function Tile({ a, g, z = 48 }: { a: string; g: number; z?: number }) {
  const art = (ART as Record<string, React.ReactNode>)[a] ?? ART.tote;
  return (
    <div className={`tile g${g}`} style={{ width: z, height: z }}>
      <svg width={z * .75} height={z * .75} viewBox="0 0 120 120">{art}</svg>
    </div>
  );
}

export function Plat({ p, z = 26 }: { p: string; z?: number }) {
  if (p === 'tiktok') {
    return (
      <span className="pm" style={{ width: z, height: z, background: '#111' }}>
        <svg width={z * .72} height={z * .72} viewBox="0 0 32 32">
          <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 8v11.5a4 4 0 1 1-4-4M17 8c.5 3 2.5 4.5 6 5" stroke="#25F4EE" transform="translate(-1 -1)"/>
            <path d="M17 8v11.5a4 4 0 1 1-4-4M17 8c.5 3 2.5 4.5 6 5" stroke="#FE2C55" transform="translate(1 1)"/>
            <path d="M17 8v11.5a4 4 0 1 1-4-4M17 8c.5 3 2.5 4.5 6 5" stroke="#fff"/>
          </g>
        </svg>
      </span>
    );
  }
  return <span className="pm" style={{ width: z, height: z, background: '#EE4D2D' }}><Ic n="box" s={z * .6} c="#fff"/></span>;
}

export const Dots = ({ n }: { n: number }) => (
  <span className="dots">{[0,1,2,3,4].map(i => <i key={i} className={i < n ? 'f' : ''} />)}</span>
);
export const CDots = ({ n }: { n: number }) => (
  <span className="dots">{[0,1,2].map(i => <i key={i} className={i < n ? 'f' : ''} />)}</span>
);

const STC: Record<string, string> = {
  Active:'t-lime', ซ่อน:'t-mut', รอตรวจ:'t-amb', อนุมัติ:'t-ok',
  Auto:'t-lil', Manual:'', สำเร็จ:'t-ok', ล้มเหลว:'t-bad', กำลังรัน:'t-lil',
};
export const Tag = ({ t, c }: { t: string; c?: string }) => (
  <span className={`tg ${c ?? STC[t] ?? ''}`}>{t}</span>
);
