'use client';

import { cols, nf, scoreColor, TH_DATETIME, type RunWithDelta } from './shared';

const RUN_COLS = '150px 90px 90px 110px 90px 100px 1fr 90px';

function deltaTag(value: number, unit = '') {
  if (!value) return <span className="m">—</span>;
  const up = value > 0;
  return (
    <span className="tg" style={{ background: up ? 'var(--okS)' : 'var(--badS)', color: up ? 'var(--okT)' : 'var(--bad)' }}>
      {up ? '▲' : '▼'} {Math.abs(value)}
      {unit}
    </span>
  );
}

export function RunHistory({ runs, onReuse }: { runs: RunWithDelta[]; onReuse: (run: RunWithDelta) => void }) {
  if (runs.length === 0) {
    return <div className="card">ยังไม่มีประวัติ — สร้างกราฟในขั้น 4 แล้วประวัติจะขึ้นที่นี่</div>;
  }

  return (
    <div className="card">
      <h3>
        <span>ประวัติการรัน</span>
        <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
          เทียบกับครั้งก่อนหน้า
        </span>
      </h3>
      <div className="tbw">
        <div className="tbl" style={{ minWidth: 980 }}>
          <div className="tr h" style={cols(RUN_COLS)}>
            <span>เวลา</span>
            <span>แหล่ง</span>
            <span>สินค้า</span>
            <span>Nodes / Edges</span>
            <span>Readiness</span>
            <span>Δ Readiness</span>
            <span>ค่าที่ใช้</span>
            <span />
          </div>
          {runs.map((r) => (
            <div key={r.id} className="tr" style={cols(RUN_COLS)}>
              <span className="m">{TH_DATETIME(r.at)}</span>
              <span>
                <span className="tg t-mut">{r.source === 'db' ? 'Supabase' : 'ไฟล์'}</span>
                {r.kind === 'auto' ? (
                  <span className="tg t-mut" style={{ marginLeft: 4 }} title="ประมวลผลอัตโนมัติหลัง ingestion (ไม่สร้างกราฟ)">
                    auto
                  </span>
                ) : null}
              </span>
              <span>{nf.format(r.kept)}</span>
              <span className="m">
                {nf.format(r.nodes)} / {nf.format(r.edges)}
              </span>
              <span style={{ color: scoreColor(r.readiness), fontWeight: 800 }}>{r.readiness}</span>
              <span>{deltaTag(r.delta?.readiness ?? 0)}</span>
              <span className="m" style={{ fontSize: 12 }}>
                {r.config.dedupe} · {r.config.similarity_threshold.toFixed(2)} · nb {r.config.max_neighbors}
                {r.sync ? ` · sync:${r.sync.mode}` : ''}
              </span>
              <span>
                <button className="btn sm gh" onClick={() => onReuse(r)}>
                  ใช้ค่านี้
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
