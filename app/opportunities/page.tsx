'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ic } from '@/components/icons';
import { cols, nf, short, TH_DATETIME } from '@/components/network/shared';
import type {
  Opportunity,
  OpportunityClass,
  OpportunityDiagnostics,
  OpportunityEvidence,
} from '@/lib/network/types';

const LIST_COLS = 'minmax(0,2.2fr) 104px 92px 96px 76px 92px 88px 40px';

const CLASS_META: Record<OpportunityClass, { label: string; hint: string; cls: string }> = {
  proven: { label: 'Proven', hint: 'ขายดี + เชื่อมต่อสูง + ผ่าน trust', cls: 't-ok' },
  hidden: { label: 'Hidden', hint: 'ดีแต่ยังถูกค้นพบน้อย', cls: 't-lil' },
  emerging: { label: 'Emerging', hint: 'ใหม่ + ยอดขายเร่งตัว + รีวิวยังน้อย', cls: 't-amb' },
};

const RISK_META: Record<string, { label: string; cls: string }> = {
  low: { label: 'Risk ต่ำ', cls: 't-ok' },
  medium: { label: 'Risk กลาง', cls: 't-amb' },
  high: { label: 'Risk สูง', cls: 't-bad' },
};

const EDGE_LABEL: Record<string, string> = {
  similar_to: 'คล้ายกัน',
  substitute: 'ทดแทนกัน',
  complements: 'เสริมกัน',
  same_context: 'บริบทเดียวกัน',
  used_with: 'ใช้ด้วยกัน',
};

interface OpportunityPayload {
  ok: boolean;
  error?: string;
  hint?: string;
  generated_at?: string;
  meta?: { generated_at: string; products: number; nodes: number; edges: number };
  gate_counts: { pass: number; review: number; blocked: number };
  class_counts: Record<OpportunityClass, number>;
  risk_counts?: Record<'low' | 'medium' | 'high', number>;
  datasource_tier_counts?: Record<string, number>;
  diagnostics: OpportunityDiagnostics | null;
  total: number;
  shown: number;
  items: Opportunity[];
}

function GateChip({ status }: { status: string }) {
  const cls = status === 'pass' ? 't-ok' : status === 'review' ? 't-amb' : 't-bad';
  return <span className={`tg ${cls}`}>{status}</span>;
}

function RiskChip({ risk }: { risk: NonNullable<Opportunity['trust_risk']> }) {
  const meta = RISK_META[risk.level] ?? { label: risk.level, cls: 't-mut' };
  const title = [
    `risk: ${risk.level}`,
    ...risk.flags,
    `damage ${risk.review.damage_mentions}/${risk.review.low_star} low-star reviews`,
    risk.policy.strict_return ? 'strict return policy' : '',
    risk.policy.claim_support ? 'seller supports claims' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={`tg ${meta.cls}`} title={title}>
      {meta.label}
    </span>
  );
}

function EvidenceRow({ e }: { e: OpportunityEvidence }) {
  const shared = [
    ...e.shared.contexts.map((c) => `บริบท: ${c}`),
    ...e.shared.use_cases.map((u) => `use case: ${u}`),
    ...e.shared.functions.map((f) => `ฟังก์ชัน: ${f}`),
  ];
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="row sp">
        <b style={{ fontSize: 14 }}>{e.other.name}</b>
        <span className="tg t-mut">{EDGE_LABEL[e.edge_type] ?? e.edge_type}</span>
      </div>
      <div className="m" style={{ fontSize: 12 }}>
        น้ำหนัก {e.weight.toFixed(3)}
        {shared.length ? ` · ${shared.join(' · ')}` : ''}
        {e.quote ? ` · “${e.quote}”` : ''}
      </div>
      {e.other.url ? (
        <a href={e.other.url} target="_blank" rel="noreferrer" className="m" style={{ fontSize: 12 }}>
          เปิดสินค้า ↗
        </a>
      ) : null}
    </div>
  );
}

export default function OpportunitiesPage() {
  const [data, setData] = useState<OpportunityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | OpportunityClass>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch('/api/network/opportunities?limit=200', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setData(null);
        setError(json.error ?? 'โหลดข้อมูลไม่สำเร็จ');
        setHint(json.hint ?? null);
        return;
      }
      setData(json as OpportunityPayload);
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => {
    if (!data) return [];
    return filter === 'all' ? data.items : data.items.filter((o) => o.class === filter);
  }, [data, filter]);

  const current = useMemo(
    () => items.find((o) => o.node_key === selected) ?? items[0] ?? null,
    [items, selected],
  );

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">Home / Opportunities · Proven · Hidden · Emerging (อ้างหลักฐานทุกครั้ง)</div>
          <h1>Opportunities</h1>
        </div>
        <div className="acts">
          <button className="btn gh" onClick={load} disabled={loading}>
            <Ic n="refresh" s={16} /> {loading ? 'กำลังโหลด…' : 'รีเฟรช'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card">
          <h3>ยังไม่มีผลจัดประเภท</h3>
          <div className="m">{error}</div>
          {hint ? <div className="m">{hint}</div> : null}
          <a className="btn" href="/network" style={{ alignSelf: 'flex-start' }}>
            <Ic n="nodes" s={16} /> ไปสร้างกราฟที่หน้า Network
          </a>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="g">
            {(['proven', 'hidden', 'emerging'] as OpportunityClass[]).map((c) => (
              <button
                key={c}
                className="kpi card"
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  outline: filter === c ? '2px solid var(--lilT)' : 'none',
                }}
                onClick={() => setFilter(filter === c ? 'all' : c)}
              >
                <div className="m">{CLASS_META[c].label}</div>
                <b style={{ fontSize: 28 }}>{nf.format(data.class_counts[c] ?? 0)}</b>
                <div className="m" style={{ fontSize: 12 }}>
                  {CLASS_META[c].hint}
                </div>
              </button>
            ))}
          </div>

          <div className="card">
            <div className="row sp" style={{ flexWrap: 'wrap' }}>
              <div className="m">
                Gate: {nf.format(data.gate_counts.pass)} ผ่าน · {nf.format(data.gate_counts.review)} ตรวจ ·{' '}
                {nf.format(data.gate_counts.blocked)} บล็อก
                {data.risk_counts
                  ? ` · Risk สูง ${nf.format(data.risk_counts.high ?? 0)}`
                  : ''}{' '}
                · snapshot {TH_DATETIME(data.generated_at)}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className={'btn sm ' + (filter === 'all' ? '' : 'gh')}
                  onClick={() => setFilter('all')}
                >
                  ทั้งหมด {nf.format(data.total)}
                </button>
                {(Object.keys(CLASS_META) as OpportunityClass[]).map((c) => (
                  <button
                    key={c}
                    className={'btn sm ' + (filter === c ? '' : 'gh')}
                    onClick={() => setFilter(c)}
                  >
                    {CLASS_META[c].label} {nf.format(data.class_counts[c] ?? 0)}
                  </button>
                ))}
              </div>
            </div>
            {data.diagnostics?.note ? (
              <div className="warn" style={{ fontSize: 13 }}>
                <Ic n="warn" s={16} /> {data.diagnostics.note}
              </div>
            ) : null}
          </div>

          <div className="g" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div className="tbw" style={{ flex: 1, minWidth: 0 }}>
              <div className="tbl" style={{ minWidth: 720 }}>
                <div className="tr h" style={cols(LIST_COLS)}>
                  <span>สินค้า</span>
                  <span>ชั้น</span>
                  <span>Gate</span>
                  <span>ราคา</span>
                  <span>Degree</span>
                  <span>ขายแล้ว</span>
                  <span>Fit</span>
                  <span />
                </div>
                {items.length ? (
                  items.map((o) => (
                    <div
                      key={o.node_key}
                      className={'tr cl ' + (current?.node_key === o.node_key ? 's' : '')}
                      style={cols(LIST_COLS)}
                      onClick={() => setSelected(o.node_key)}
                    >
                      <span className="row" style={{ minWidth: 0, gap: 8 }}>
                        <span
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            overflow: 'hidden',
                            background: 'var(--soft)',
                            flex: 'none',
                          }}
                        >
                          {o.image ? (
                            <img
                              src={o.image}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : null}
                        </span>
                        <b style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {short(o.name, 64)}
                        </b>
                      </span>
                      <span>
                        <span className={`tg ${CLASS_META[o.class].cls}`}>{CLASS_META[o.class].label}</span>
                      </span>
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <GateChip status={o.gate.status} />
                        {o.trust_risk ? <RiskChip risk={o.trust_risk} /> : null}
                      </span>
                      <span className="m">฿{nf.format(Math.round(o.price))}</span>
                      <span className="m">{o.metrics.degree}</span>
                      <span className="m">{nf.format(o.historical_sold)}</span>
                      <span className="m">{(o.metrics.audience_fit * 100).toFixed(0)}%</span>
                      <span className="m">›</span>
                    </div>
                  ))
                ) : (
                  <div className="m" style={{ padding: 40, textAlign: 'center' }}>
                    ไม่มีรายการในกลุ่มนี้
                  </div>
                )}
              </div>
            </div>

            <div className="card" style={{ width: 420, flex: 'none' }}>
              {!current ? (
                <div className="m">เลือกสินค้าจากรายการ</div>
              ) : (
                <>
                  <div className="row sp">
                    <h3 style={{ margin: 0 }}>{short(current.name, 42)}</h3>
                    <span className={`tg ${CLASS_META[current.class].cls}`}>
                      {CLASS_META[current.class].label}
                    </span>
                  </div>
                  <div className="m">
                    Shopee tier: <b>{current.datasource_tier ?? '—'}</b> (popularity only) · Internal tier:{' '}
                    <b>{current.internal_tier ?? current.class}</b>
                  </div>
                  <div className="m">{current.explain_th}</div>
                  {current.trust_risk ? (
                    <div
                      className="card"
                      style={{ boxShadow: 'none', background: 'var(--bg)', padding: 12, marginTop: 8 }}
                    >
                      <div className="row sp">
                        <b style={{ fontSize: 13 }}>ความเสี่ยงจากรีวิว/นโยบายร้าน</b>
                        <RiskChip risk={current.trust_risk} />
                      </div>
                      <div className="m" style={{ fontSize: 12 }}>
                        รีวิว 1–2 ดาว {current.trust_risk.review.low_star} รายการ · พบคำแจ้งเสียหาย{' '}
                        {current.trust_risk.review.damage_mentions} รายการ
                        {current.trust_risk.distribution.low_star_share != null
                          ? ` · สัดส่วน 1–2 ดาวทั้งร้าน ${(current.trust_risk.distribution.low_star_share * 100).toFixed(1)}%`
                          : ''}
                      </div>
                      {current.trust_risk.policy.strict_return ? (
                        <div className="m" style={{ fontSize: 12, color: 'var(--bad)' }}>
                          ⚠ นโยบายร้าน: ไม่รับเคลม/คืน/เปลี่ยนหลังยืนยัน
                        </div>
                      ) : null}
                      {current.trust_risk.policy.claim_support ? (
                        <div className="m" style={{ fontSize: 12, color: 'var(--ok)' }}>
                          ✓ พบข้อมูลร้านรับเคลม/เปลี่ยน/ประกัน
                        </div>
                      ) : null}
                      {current.trust_risk.policy.evidence ? (
                        <div className="m" style={{ fontSize: 12 }}>
                          “{short(current.trust_risk.policy.evidence, 180)}”
                        </div>
                      ) : null}
                      {current.trust_risk.review.quotes.length ? (
                        <details style={{ marginTop: 6 }}>
                          <summary className="m" style={{ fontSize: 12, cursor: 'pointer' }}>
                            ดูรีวิวที่ใช้เป็นหลักฐาน
                          </summary>
                          {current.trust_risk.review.quotes.map((q, i) => (
                            <div key={`${q.rating}-${i}`} className="m" style={{ fontSize: 12 }}>
                              {q.rating}★ · “{q.comment}”
                            </div>
                          ))}
                        </details>
                      ) : null}
                    </div>
                  ) : null}
                  {current.metrics.audience_fit_basis !== 'audience' && current.metrics.audience_fit > 0 ? (
                    <div className="m" style={{ fontSize: 12 }}>
                      * Audience Fit อิงบริบท/use case (ยังไม่มีข้อมูล Creator ในระบบ)
                    </div>
                  ) : null}

                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div className="m b">ทำไมแนะนำ</div>
                  {current.evidence.length ? (
                    current.evidence.map((e, i) => <EvidenceRow key={`${e.other.node_key}-${i}`} e={e} />)
                  ) : (
                    <div className="m">ยังไม่มี edge ที่อ้างอิงได้ (สินค้านี้เป็น isolate)</div>
                  )}

                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div className="m b">ตัวชี้วัด</div>
                  {([
                    ['Degree', `${current.metrics.degree} (top ${Math.round((1 - current.metrics.degree_pct) * 100)}%)`],
                    ['Strength', current.metrics.strength.toFixed(3)],
                    ['PageRank', current.metrics.pagerank.toFixed(6)],
                    ['ขายแล้ว', `${nf.format(current.historical_sold)} (top ${Math.round((1 - current.metrics.sold_pct) * 100)}%)`],
                    ['Demand ของบริบท', `top ${Math.round((1 - current.metrics.context_demand_pct) * 100)}%`],
                    ['Rating', current.metrics.rating != null ? current.metrics.rating.toFixed(2) : '—'],
                    ['Risk', current.metrics.risk_level ?? '—'],
                    ['Risk penalty', (current.metrics.risk_penalty ?? 0).toFixed(2)],
                    [
                      'อายุ listing',
                      current.metrics.listing_age_days != null ? `${current.metrics.listing_age_days} วัน` : '—',
                    ],
                  ] as Array<[string, string]>).map(([k, v]) => (
                    <div key={k} className="row sp">
                      <span className="m">{k}</span>
                      <b style={{ fontSize: 13 }}>{v}</b>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
