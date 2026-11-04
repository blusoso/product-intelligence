'use client';

import { Ic } from '@/components/icons';
import {
  cols,
  nf,
  scoreColor,
  sevColor,
  sevIcon,
  short,
  type AuditReport,
  type DroppedRecord,
  type MergeRecord,
} from './shared';

export function Findings({
  report,
  dropped,
  merged,
}: {
  report: AuditReport;
  dropped: DroppedRecord[];
  merged: MergeRecord[];
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <h3>องค์ประกอบคะแนน</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {report.dimensions.map((d) => (
            <div key={d.id}>
              <div className="row sp" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>{d.label}</span>
                <span className="m">
                  {d.score} / 100 · {d.weight > 0 ? `น้ำหนัก ${Math.round(d.weight)}%` : 'ไม่ถ่วงคะแนน'}
                </span>
              </div>
              <div className="bar">
                <i
                  style={{
                    width: `${Math.max(2, Math.min(100, d.score))}%`,
                    background: scoreColor(d.score),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {report.sections.map((section) => (
        <div key={section.id} className="card">
          <h3>
            <span>
              {section.icon} {section.title}
            </span>
            <span className="m" style={{ fontWeight: 500 }}>
              {section.findings.length} findings
            </span>
          </h3>
          {section.findings.length === 0 ? (
            <div className="m" style={{ color: 'var(--ok)' }}>
              <Ic n="chk" s={16} /> ไม่พบปัญหา
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {section.findings.map((f) => (
                <div
                  key={f.id}
                  className="iss"
                  style={{ background: 'var(--bg)', borderLeft: `4px solid ${sevColor(f.severity)}` }}
                >
                  <div className="row sp">
                    <b>
                      {sevIcon(f.severity)} {f.title}
                    </b>
                    <span className="tg t-mut">{nf.format(f.count)} records</span>
                  </div>
                  <div className="m">{f.description}</div>
                  {(f.samples?.length ?? 0) > 0 && (
                    <details>
                      <summary className="m" style={{ cursor: 'pointer' }}>
                        ดูตัวอย่าง
                      </summary>
                      <pre className="code" style={{ marginTop: 8, maxHeight: 220 }}>
                        {JSON.stringify(f.samples, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {(dropped.length > 0 || merged.length > 0) && (
        <div className="card">
          <h3>รายการที่ถูกทิ้ง / รวม</h3>
          {dropped.length > 0 && (
            <details open>
              <summary style={{ cursor: 'pointer', color: 'var(--bad)', fontWeight: 700 }}>
                ทิ้ง {dropped.length} รายการ
              </summary>
              <div className="tbw" style={{ marginTop: 10 }}>
                <div className="tbl">
                  <div className="tr h" style={cols('1.4fr 2fr 1.2fr')}>
                    <span>product_id</span>
                    <span>ชื่อ</span>
                    <span>เหตุผล</span>
                  </div>
                  {dropped.map((d, i) => (
                    <div key={`${d.product_id}-${i}`} className="tr" style={cols('1.4fr 2fr 1.2fr')}>
                      <span className="m">{String(d.product_id)}</span>
                      <span>{short(d.name, 40) || '—'}</span>
                      <span className="tg t-bad">{d.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
          {merged.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                รวมรายการซ้ำ {merged.length} กลุ่ม
              </summary>
              <div className="tbw" style={{ marginTop: 10 }}>
                <div className="tbl">
                  <div className="tr h" style={cols('1.4fr 2fr 90px')}>
                    <span>key</span>
                    <span>เก็บจาก</span>
                    <span>รวม</span>
                  </div>
                  {merged.map((m) => (
                    <div key={m.key} className="tr" style={cols('1.4fr 2fr 90px')}>
                      <span className="m">{m.key}</span>
                      <span className="m">{String(m.kept_from)}</span>
                      <span className="tg t-lil">{m.merged + 1} → 1</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
