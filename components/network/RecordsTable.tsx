'use client';

import { useMemo, useState } from 'react';
import { Ic } from '@/components/icons';
import { cols, nf, short, type CleanChange, type NormalizedProduct } from './shared';
import type { ProductAttribute } from '@/lib/network/types';

const REC_COLS = 'minmax(0,2.2fr) 120px 120px 100px 100px 110px 95px 95px';

const SOURCE_BADGE: Record<string, { label: string; style: React.CSSProperties }> = {
  evidence: { label: 'หลักฐาน', style: { background: 'var(--soft)', color: 'var(--ink)' } },
  computed: { label: 'คำนวณ', style: { border: '1px solid var(--line)', background: 'transparent', color: 'var(--mute)' } },
  ai_inferred: { label: 'AI', style: { border: '1px dashed #B05BD0', background: 'transparent', color: '#8B3FAE' } },
  manual: { label: 'คนแก้', style: { border: '1.5px solid var(--lilT)', background: 'var(--lil)', color: 'var(--lilT)' } },
};

function SourceChip({ source }: { source: string }) {
  const b = SOURCE_BADGE[source] ?? { label: source, style: {} };
  return (
    <span className="tg" style={{ fontSize: 11, padding: '1px 7px', ...b.style }}>
      {b.label}
    </span>
  );
}

export function RecordsTable({
  records,
  changes,
}: {
  records: NormalizedProduct[];
  changes: CleanChange[];
}) {
  const [q, setQ] = useState('');
  const [openExt, setOpenExt] = useState<string | null>(null);
  const [attrs, setAttrs] = useState<ProductAttribute[] | null>(null);
  const [attrsLoading, setAttrsLoading] = useState(false);
  const [attrsError, setAttrsError] = useState<string | null>(null);

  const openAttributes = async (r: NormalizedProduct) => {
    setOpenExt(String(r.ext));
    setAttrs(null);
    setAttrsError(null);
    setAttrsLoading(true);
    try {
      const res = await fetch(`/api/network/attributes?ext=${encodeURIComponent(String(r.ext))}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'โหลด attribute ไม่ได้');
      setAttrs(json.attributes as ProductAttribute[]);
    } catch (e) {
      setAttrsError((e as Error).message);
    } finally {
      setAttrsLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((r) =>
      [
        r.name,
        r.brand ?? '',
        r.province,
        r.category,
        r.product_type,
        r.shop_name,
        ...(r.enrichment?.use_cases ?? []).map((t) => t.value),
        ...(r.enrichment?.contexts ?? []).map((t) => t.value),
        ...(r.enrichment?.styles ?? []).map((t) => t.value),
        r.enrichment?.price_segment?.label ?? '',
        ...(r.ai?.tags ?? []).map((t) => t.value),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [records, q]);

  if (records.length === 0) {
    return <div className="card">ยังไม่มีข้อมูล — สร้างกราฟในขั้น 4 ก่อน</div>;
  }

  const openRecord = records.find((r) => String(r.ext) === openExt) ?? null;

  return (
    <>
      <div className="card">
        <h3>
          <span>สินค้าหลัง Normalize</span>
          <span className="m" style={{ fontWeight: 500 }}>
            {nf.format(filtered.length)} / {nf.format(records.length)} รายการ
          </span>
        </h3>
        <label className="srch" style={{ width: '100%', background: 'var(--bg)' }}>
          <Ic n="search" s={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อ แบรนด์ จังหวัด ประเภท use case… (รวมค่าจาก AI)"
          />
        </label>
        <div className="tbw">
          <div className="tbl">
            <div className="tr h" style={cols(REC_COLS)}>
              <span>สินค้า</span>
              <span>หมวด</span>
              <span>ประเภท</span>
              <span>แบรนด์</span>
              <span>จังหวัด</span>
              <span>ขนาด</span>
              <span>ราคา</span>
              <span>คุณภาพ</span>
            </div>
            {filtered.map((r) => (
              <div key={r.node_key || `${r.shop_id}:${r.product_id}`} className="tr" style={cols(REC_COLS)}>
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {short(r.name, 60)}
                  </b>
                  <span className="m">
                    {r.shop_name || '—'} · {nf.format(r.monthly_sold)}/เดือน
                    {r.listing_count > 1 ? ` · 🔗 ${r.listing_count} listing` : ''}
                  </span>
                  <button
                    className="btn sm gh"
                    style={{ marginTop: 4, padding: '2px 8px', fontSize: 12 }}
                    onClick={() => openAttributes(r)}
                    title="ดู Product Attributes มาตรฐาน 18 รายการ พร้อมที่มา (หลักฐาน/คำนวณ/AI)"
                  >
                    attributes
                  </button>
                </span>
                <span className="m" title={r.category}>
                  {r.category}
                </span>
                <span>
                  <span className="tg t-mut">{r.product_type}</span>
                  {r.enrichment?.use_cases?.length ? (
                    <span
                      className="m"
                      style={{ display: 'block', marginTop: 2 }}
                      title={[
                        `use case: ${r.enrichment.use_cases.map((t) => `${t.value} (${Math.round(t.confidence * 100)}%)`).join(', ')}`,
                        `บริบท: ${(r.enrichment.contexts ?? []).map((t) => t.value).join(', ') || '—'}`,
                        `ช่วงราคา: ${r.enrichment.price_segment.label} (${r.enrichment.price_segment.basis})`,
                      ].join(' · ')}
                    >
                      {r.enrichment.use_cases[0].value}
                      {r.enrichment.price_segment.label !== 'Unknown'
                        ? ` · ${r.enrichment.price_segment.label}`
                        : ''}
                    </span>
                  ) : null}
                  {r.ai?.tags?.length ? (
                    <span
                      className="tg"
                      style={{ marginTop: 2, background: 'transparent', border: '1px dashed #B05BD0', color: '#8B3FAE' }}
                      title={[
                        `AI อนุมาน (${r.ai.meta?.status ?? 'ok'} · ${r.ai.meta?.model ?? ''})`,
                        ...r.ai.tags.map(
                          (t) =>
                            `${t.attribute}: ${t.value} (${Math.round(t.confidence * 100)}%${
                              t.evidence_type === 'image'
                                ? ' · จากภาพ'
                                : t.origin === 'phrase'
                                  ? ' · จากพจนานุกรม'
                                  : t.grounded
                                    ? ' · อ้างคำจริง'
                                    : ' · อนุมาน'
                            }${t.region ? ` @${t.region}` : ''}${t.conflict ? ' · ขัดกับหลักฐาน' : ''})`,
                        ),
                      ].join('\n')}
                    >
                      AI {r.ai.tags.length}
                    </span>
                  ) : null}
                </span>
                <span className="m">{r.brand ?? '—'}</span>
                <span className="m">{r.province}</span>
                <span className="m" title={r.size_options.length ? `ตัวเลือก: ${r.size_options.join(' · ')}` : undefined}>
                  {r.size_label ?? (r.size_options.length ? `${r.size_options.length} ขนาด` : '—')}
                  {r.variant_count > 0 && (
                    <span className="m" style={{ marginLeft: 4 }}>
                      ({r.variant_count})
                    </span>
                  )}
                </span>
                <span className="m">
                  ฿{nf.format(Math.round(r.price))}
                  {r.price_history?.last_change_pct != null && (
                    <span
                      className="m"
                      title={`ประวัติ ${r.price_history.observations} ครั้ง · ต่ำสุด ฿${nf.format(r.price_history.min)} · สูงสุด ฿${nf.format(r.price_history.max)}`}
                      style={{
                        marginLeft: 4,
                        color: r.price_history.last_change_pct > 0 ? 'var(--bad)' : 'var(--ok)',
                      }}
                    >
                      {r.price_history.last_change_pct > 0 ? '+' : ''}
                      {r.price_history.last_change_pct}%
                    </span>
                  )}
                </span>
                <span>
                  <span
                    className="tg"
                    style={{
                      background: r.quality_score >= 80 ? 'var(--okS)' : 'var(--amb)',
                      color: r.quality_score >= 80 ? 'var(--okT)' : 'var(--ambT)',
                    }}
                  >
                    {r.quality_score}
                  </span>
                  {r.quality_flags.length > 0 && (
                    <span className="m" style={{ marginLeft: 6 }} title={r.quality_flags.join(', ')}>
                      ⚑{r.quality_flags.length}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="m" style={{ fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>
            <SourceChip source="evidence" /> สกัดได้จากข้อความ (ตรวจย้อนได้)
          </span>
          <span>
            <SourceChip source="computed" /> คำนวณจากตัวเลข/กฎ
          </span>
          <span>
            <SourceChip source="ai_inferred" /> AI อนุมาน — แยกจากหลักฐานเสมอ
          </span>
          <span>
            <SourceChip source="manual" /> คนแก้ — ใช้แทนค่าอื่นของช่องนั้น
          </span>
        </div>
      </div>

      {openExt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.5)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setOpenExt(null)}
        >
          <div
            className="card"
            style={{ width: 'min(820px, 94vw)', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row sp" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Product Attributes: {short(openRecord?.name ?? '', 60)}</h3>
              <button className="ib sq" onClick={() => setOpenExt(null)}>
                ✕
              </button>
            </div>
            <div className="m" style={{ fontSize: 12 }}>
              ชุดมาตรฐาน {attrs?.length ?? 18} รายการ — ทุกสินค้าใช้คีย์เดียวกัน · ค่าที่ AI ให้จะมีป้าย “AI” และแยกจากหลักฐาน
              {openRecord?.ai?.meta?.model ? ` · model: ${openRecord.ai.meta.model}` : ''}
            </div>
            {attrsLoading ? <div className="m">กำลังโหลด…</div> : null}
            {attrsError ? <div className="warn">{attrsError}</div> : null}
            {attrs && (
              <div className="tbl" style={{ marginTop: 8 }}>
                {attrs.map((a) => (
                  <div
                    key={a.attribute}
                    className="tr"
                    style={{
                      ...cols('190px 1fr'),
                      alignItems: 'start',
                      paddingTop: 6,
                      paddingBottom: 6,
                    }}
                  >
                    <span>
                      <b style={{ fontSize: 13 }}>{a.label}</b>
                      <span className="m" style={{ display: 'block', fontSize: 11 }}>
                        {a.attribute} · {a.status === 'none' ? 'ไม่มีข้อมูล' : a.status}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                      {a.values.length === 0 ? <span className="m">—</span> : null}
                      {a.values.map((v, i) => (
                        <span
                          key={`${v.value_id}-${v.source}-${i}`}
                          className="tg"
                          style={{
                            gap: 6,
                            border:
                              v.source === 'ai_inferred'
                                ? '1px dashed #B05BD0'
                                : v.source === 'manual'
                                  ? '1.5px solid var(--lilT)'
                                  : '1px solid transparent',
                            background:
                              v.source === 'ai_inferred' ? 'transparent' : v.source === 'manual' ? 'var(--lil)' : 'var(--soft)',
                            color: v.source === 'ai_inferred' ? '#8B3FAE' : v.source === 'manual' ? 'var(--lilT)' : 'var(--ink)',
                          }}
                          title={[
                            `source: ${v.source} · confidence ${Math.round(v.confidence * 100)}%`,
                            v.source === 'ai_inferred'
                              ? `${v.grounded ? 'อ้างคำจริงในข้อความ' : 'อนุมาน'}${v.conflict ? ' · ขัดกับหลักฐาน' : ''}${v.ai_model ? ` · ${v.ai_model}` : ''}`
                              : '',
                            ...(v.evidence ?? []),
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        >
                          {v.source === 'ai_inferred' ? 'AI ' : ''}
                          {v.label}
                          <span style={{ opacity: 0.6, fontWeight: 500 }}>
                            {Math.round(v.confidence * 100)}%
                          </span>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="card">
          <h3>
            <span>การแก้ไขระหว่างทาง</span>
            <span className="m" style={{ fontWeight: 500 }}>
              {nf.format(changes.length)} รายการ
            </span>
          </h3>
          <details>
            <summary className="m" style={{ cursor: 'pointer' }}>
              ดู change log
            </summary>
            <pre className="code" style={{ marginTop: 10, maxHeight: 360 }}>
              {changes
                .slice(0, 120)
                .map(
                  (c) =>
                    `${String(c.product_id)} · ${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)} [${c.rule}]`,
                )
                .join('\n')}
            </pre>
          </details>
        </div>
      )}
    </>
  );
}
