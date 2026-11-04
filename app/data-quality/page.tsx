'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Ic } from '@/components/icons';
import { useApp } from '@/lib/store';

type Report = any;
type CleanResult = any;
type LegacyInfo = {
  count: number;
  total: number;
  samples?: any[];
};

const sevColor = (s: string) =>
  s === 'critical' ? 'var(--bad, #c00)' : s === 'warning' ? 'var(--warn, #f5a623)' : 'var(--mute)';

const sevIcon = (s: string) => (s === 'critical' ? '🚨' : s === 'warning' ? '⚠️' : 'ℹ️');

const scoreColor = (s: number) => {
  if (s >= 80) return 'var(--ok, #0a7)';
  if (s >= 50) return 'var(--warn, #f5a623)';
  return 'var(--bad, #c00)';
};

export default function DataQualityPage() {
  const { showToast } = useApp();
  
  // States: Audit & Clean
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const [applying, setApplying] = useState(false);

  // States: Legacy Data
  const [legacyInfo, setLegacyInfo] = useState<LegacyInfo | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // Functions: Audit & Clean
  // ─────────────────────────────────────────────────────────────
  const loadAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-quality/audit', { cache: 'no-store' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setReport(data.report);
      setCleanResult(null);
    } catch (e: any) {
      showToast('โหลด audit ไม่ได้: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const previewClean = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-quality/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: false }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setCleanResult(data);
      showToast(`Preview: ${data.summary.changes} changes, ${data.summary.dropped} dropped`);
    } catch (e: any) {
      showToast('Preview ไม่ได้: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const applyClean = async () => {
    if (!confirm('บันทึกทับไฟล์ data/products.json? (ระบบสำรองไฟล์เดิมให้อัตโนมัติ)')) return;
    setApplying(true);
    try {
      const res = await fetch('/api/data-quality/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setCleanResult(data);
      showToast(`✅ Applied! ${data.summary.output} products, ${data.summary.changes} changes`);
      await loadAudit(); // โหลด Audit ใหม่หลัง Clean
      await loadLegacy(); // อัปเดตจำนวน Legacy
    } catch (e: any) {
      showToast('Apply ไม่ได้: ' + e.message);
    } finally {
      setApplying(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Functions: Legacy Data
  // ─────────────────────────────────────────────────────────────
  const loadLegacy = async () => {
    try {
      const res = await fetch('/api/data-quality/legacy', { cache: 'no-store' });
      const data = await res.json();
      if (data.ok) setLegacyInfo(data);
    } catch {}
  };

  const purgeLegacy = async () => {
    if (!legacyInfo || legacyInfo.count === 0) return;
    if (!confirm(`ลบข้อมูลเก่าที่ไม่สมบูรณ์ ${legacyInfo.count} รายการ?\n(ระบบจะ Backup ข้อมูลเดิมไว้ให้อัตโนมัติ)`)) return;
    
    setLegacyLoading(true);
    try {
      const res = await fetch('/api/data-quality/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge' }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`✅ ลบข้อมูลเก่าสำเร็จ ${data.removed} รายการ`);
        await loadAudit();
        await loadLegacy();
      }
    } catch {
      showToast('❌ ลบไม่สำเร็จ');
    } finally {
      setLegacyLoading(false);
    }
  };

  const exportLegacy = async () => {
    try {
      const res = await fetch('/api/data-quality/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export' }),
      });
      const data = await res.json();
      if (data.ok && data.ids) {
        const blob = new Blob([JSON.stringify(data.ids, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `legacy_ids_${Date.now()}.json`;
        a.click();
        showToast('✅ ดาวน์โหลด ID แล้ว');
      }
    } catch {
      showToast('❌ Export ไม่สำเร็จ');
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Initial Load
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAudit();
    loadLegacy();
  }, []);

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">Home / Data Quality</div>
          <h1>Data Quality</h1>
          <div className="m" style={{ marginTop: 4 }}>
            ตรวจและแก้ไฟล์ต้นแบบในเครื่อง (data/products.json)
          </div>
        </div>
        <div className="acts">
          <button className="btn gh" onClick={loadAudit} disabled={loading}>
            <Ic n="refresh" s={17} /> {loading ? 'กำลังโหลด…' : 'Refresh'}
          </button>
          <button className="btn gh" onClick={previewClean} disabled={loading}>
            <Ic n="eye" s={17} /> ดูก่อนบันทึก
          </button>
          <button className="btn" onClick={applyClean} disabled={applying || loading}>
            <Ic n="chk" s={17} /> {applying ? 'กำลังบันทึก…' : 'บันทึกทับไฟล์'}
          </button>
        </div>
      </div>

      <div className="card" style={{ borderLeft: '4px solid var(--lilT)', background: 'var(--lil)' }}>
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <b style={{ fontSize: 15 }}>หน้านี้แก้ “ไฟล์ในเครื่อง” ไม่ใช่ฐานข้อมูล</b>
            <div className="m" style={{ marginTop: 6, color: 'var(--ink)' }}>
              ทุกปุ่มด้านบนอ่าน/เขียน <code>data/products.json</code> (มี .bak สำรองให้อัตโนมัติ) และไม่ส่งอะไรไป Supabase —
              ถ้าต้องการตรวจ/แปลงข้อมูลจริงที่ scraper เก็บไว้ หรือสร้างกราฟ ให้ใช้หน้า Network
            </div>
          </div>
          <Link href="/network" className="btn sm" style={{ textDecoration: 'none' }}>
            ไปที่ Network
          </Link>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          Legacy Data Manager (แจ้งเตือนข้อมูลเก่า)
      ───────────────────────────────────────────────────────────── */}
      {legacyInfo && legacyInfo.count > 0 && (
        <div
          className="card"
          style={{
            borderLeft: '4px solid var(--warn, #f5a623)',
            background: 'var(--warn-bg, #fff8e4)',
            marginBottom: 16,
          }}
        >
          <h3 style={{ color: 'var(--warn, #f5a623)' }}>⚠️ ตรวจพบข้อมูลนำเข้าแบบเก่า</h3>
          <p className="m" style={{ marginTop: 8 }}>
            มีข้อมูล <b>{legacyInfo.count}</b> รายการที่ขาดฟิลด์สำคัญ (Rating, Sold)
            เนื่องจากระบบนำเข้าเดิมถูกตั้งค่าให้รับเฉพาะข้อมูลพื้นฐาน
            ข้อมูลเหล่านี้จะไม่สามารถวิเคราะห์หรือ Clean ได้อย่างสมบูรณ์
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={purgeLegacy} disabled={legacyLoading}>
              <Ic n="trash" s={16} /> {legacyLoading ? 'กำลังลบ...' : `ลบข้อมูลเก่า (${legacyInfo.count})`}
            </button>
            <button className="btn sm gh" onClick={exportLegacy}>
              <Ic n="upload" s={16} /> Export IDs
            </button>
            <div className="m" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12 }}>
              💡 แนะนำ: ลบข้อมูลเก่า แล้ว Scrape ใหม่จาก Extension
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          Audit Score
      ───────────────────────────────────────────────────────────── */}
      {!report ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          {loading ? 'กำลังโหลด…' : 'ยังไม่มีข้อมูล'}
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: scoreColor(report.score) }}>
              {report.score}
            </div>
            <div className="m">Quality Score · {report.total} products</div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 16 }}>
              <span>
                🚨 Critical: <b style={{ color: 'var(--bad)' }}>{report.summary.critical}</b>
              </span>
              <span>
                ⚠️ Warning: <b style={{ color: 'var(--warn)' }}>{report.summary.warning}</b>
              </span>
              <span>
                ℹ️ Info: <b style={{ color: 'var(--mute)' }}>{report.summary.info}</b>
              </span>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────
              Audit Sections
          ───────────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gap: 12 }}>
            {report.sections.map((section: any) => (
              <div key={section.id} className="card">
                <h3 style={{ marginBottom: 12 }}>
                  {section.icon} {section.title}
                  <span className="m" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                    ({section.findings.length} findings)
                  </span>
                </h3>
                {section.findings.length === 0 ? (
                  <div className="m" style={{ color: 'var(--ok, #0a7)' }}>
                    <Ic n="chk" s={16} /> ไม่พบปัญหา
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {section.findings.map((f: any) => (
                      <div
                        key={f.id}
                        style={{
                          padding: 12,
                          background: 'var(--bg, #f9f9f9)',
                          borderRadius: 8,
                          borderLeft: `4px solid ${sevColor(f.severity)}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <b style={{ fontSize: 14 }}>
                            {sevIcon(f.severity)} {f.title}
                          </b>
                          <span style={{ fontSize: 13, color: sevColor(f.severity), fontWeight: 700 }}>
                            {f.count} records
                          </span>
                        </div>
                        <div className="m" style={{ marginTop: 4, fontSize: 13 }}>
                          {f.description}
                          {f.auto_fixable && (
                            <span
                              style={{
                                marginLeft: 8,
                                padding: '1px 6px',
                                background: 'var(--ok-bg, #f0faf4)',
                                color: 'var(--ok, #0a7)',
                                borderRadius: 4,
                                fontSize: 11,
                              }}
                            >
                              🔧 auto-fixable
                            </span>
                          )}
                        </div>
                        {f.samples && f.samples.length > 0 && (
                          <details style={{ marginTop: 6, fontSize: 12 }}>
                            <summary style={{ cursor: 'pointer', color: 'var(--mute)' }}>
                              ดูตัวอย่าง
                            </summary>
                            <pre
                              style={{
                                fontSize: 11,
                                background: 'var(--card)',
                                padding: 8,
                                borderRadius: 4,
                                marginTop: 6,
                                overflow: 'auto',
                                maxHeight: 200,
                              }}
                            >
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
          </div>

          {/* ─────────────────────────────────────────────────────────
              Clean Result Preview
          ───────────────────────────────────────────────────────── */}
          {cleanResult && (
            <div className="card" style={{ marginTop: 16, borderLeft: '4px solid var(--ok, #0a7)' }}>
              <h3>
                🔧 Clean Result
                {cleanResult.applied && <span style={{ color: 'var(--ok)' }}> — APPLIED</span>}
              </h3>
              <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                <span>
                  Input: <b>{cleanResult.summary.input}</b>
                </span>
                <span>
                  Output: <b style={{ color: 'var(--ok)' }}>{cleanResult.summary.output}</b>
                </span>
                <span>
                  Dropped: <b style={{ color: 'var(--bad)' }}>{cleanResult.summary.dropped}</b>
                </span>
                <span>
                  Changes: <b>{cleanResult.summary.changes}</b>
                </span>
                <span className="m">({cleanResult.summary.elapsed_ms}ms)</span>
              </div>
              {cleanResult.summary.input > 0 && (
                <div style={{ marginTop: 8 }}>
                  Score: <b>{cleanResult.report_before.score}</b> →{' '}
                  <b style={{ color: scoreColor(cleanResult.report_after.score), fontSize: 18 }}>
                    {cleanResult.report_after.score}
                  </b>
                </div>
              )}
              {cleanResult.dropped && cleanResult.dropped.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--bad)' }}>
                    Dropped records ({cleanResult.dropped.length})
                  </summary>
                  <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
                    {JSON.stringify(cleanResult.dropped, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}