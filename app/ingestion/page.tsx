'use client';
import { useState, useEffect, useCallback } from 'react';
import { useApp, usePending } from '@/lib/store';
import { Ic, Plat, Tag } from '@/components/icons';

type Job = {
  t: string;
  s: string;
  n: number | string;
  u: number | string;
  f: number;
  st: 'สำเร็จ' | 'ล้มเหลว' | 'กำลังรัน';
};

type Stats = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
};

type LogEntry = {
  at: string;
  source: string;
  keyword?: string | null;
  added: number;
  updated: number;
  received: number;
};

// ─── Helper: แปลง Source ให้อ่านง่ายและตัด Token ลับ ───
function formatSource(src: string): { label: string; tip: string } {
  if (!src) return { label: '—', tip: '' };

  // 1) รูปแบบมาตรฐาน: "Shopee | Market | keyword"
  if (src.includes('|')) {
    const parts = src.split('|').map((s) => s.trim());
    const app = parts[0] || 'Shopee';
    const feature = parts[1] || '';
    const context = parts[2] || '';

    if (feature.includes('Captcha')) return { label: '🚨 Captcha/Block', tip: src };

    let featureStr = feature;
    if (feature === 'Market') featureStr = '🏆 Market';
    else if (feature === 'Gems') featureStr = '💎 Gems';
    else if (feature === 'Overview') featureStr = '📊 Overview';

    const contextStr = context && context !== 'N/A' ? ` · ${context}` : '';
    return { label: `🛍️ ${app} · ${featureStr}${contextStr}`, tip: src };
  }

  // 2) Fallback: URL เก่า
  if (src.startsWith('http')) {
    if (src.includes('captcha') || src.includes('verify')) {
      return { label: '🚨 Captcha/Block', tip: src.slice(0, 200) };
    }
    try {
      const u = new URL(src);
      const kw = u.searchParams.get('keyword');
      if (kw) return { label: `🛍️ Shopee · 🏆 Market · ${decodeURIComponent(kw)}`, tip: src };
      return { label: '🛍️ Shopee · 🏆 Market', tip: src };
    } catch {
      return { label: '🛍️ Shopee', tip: src };
    }
  }

  // 3) Fallback: ข้อมูลเก่าที่เป็นแค่คำ Keyword
  return { label: `🛍️ Shopee · 🏆 Market · ${src}`, tip: src };
}

export default function IngestionPage() {
  const { showToast, apiKey, regenKey, setModal } = useApp();
  const p = usePending();

  const [opts, setOpts] = useState<boolean[]>([true, true, true]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [lastIngest, setLastIngest] = useState<LogEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const toggleOpt = (i: number) => setOpts((o) => o.map((v, k) => (k === i ? !v : v)));

  const refreshIngestLog = useCallback(async () => {
    setRefreshing(true);
    setLastError(null);
    try {
      const res = await fetch('/api/ingest', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const list: LogEntry[] = data.log || [];
      setJobs(
        list.map((e) => ({
          t: new Date(e.at).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          s: e.source || 'extension',
          n: e.added,
          u: e.updated,
          f: 0,
          st: 'สำเร็จ' as const,
        })),
      );
      setStats(data.stats || null);
      setLastIngest(list[0] ?? null);
    } catch (e: any) {
      setLastError(e.message || 'โหลด log ไม่ได้');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshIngestLog();
    const id = setInterval(refreshIngestLog, 15000);
    return () => clearInterval(id);
  }, [refreshIngestLog]);

  const maskKey = () => 'pi_live_••••••••••••' + apiKey.slice(-4);

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">
            ให้สคริปต์ดึงสินค้าเอง · แอดมินตรวจคิวและแก้เฉพาะที่ผิดปกติ
          </div>
          <h1>Ingestion</h1>
        </div>
        <div className="acts">
          <button className="btn gh" onClick={() => setModal({ kind: 'import' })}>
            <Ic n="upload" s={17} /> นำเข้า JSON
          </button>
          <button
            className="btn"
            onClick={refreshIngestLog}
            disabled={refreshing}
            style={{ opacity: refreshing ? 0.6 : 1 }}
          >
            <Ic n="refresh" s={17} />
            {refreshing ? 'กำลังโหลด...' : 'รีเฟรช'}
          </button>
        </div>
      </div>

      {/* ─── Banner: last ingest / empty state / error ─── */}
      {lastError ? (
        <div className="warn" style={{ background: 'var(--bad-bg, #fff4f4)', borderColor: 'var(--bad, #c00)', color: 'var(--bad, #c00)' }}>
          <Ic n="warn" s={20} />
          โหลด log ไม่ได้: <b>{lastError}</b> — ตรวจสอบว่า backend รันอยู่
        </div>
      ) : lastIngest ? (
        <div
          className="warn"
          style={{ background: 'var(--ok-bg, #f0faf4)', borderColor: 'var(--ok, #0a7)', color: 'var(--ok, #0a7)' }}
        >
          <Ic n="chk" s={20} />
          ล่าสุด: <b>+{lastIngest.added}</b> ใหม่ · <b>{lastIngest.updated}</b> อัปเดต ·{' '}
          {new Date(lastIngest.at).toLocaleString('th-TH')}
          <span style={{ opacity: 0.8, marginLeft: 8 }}>
            จาก {formatSource(lastIngest.source).label}
            {lastIngest.keyword ? ` · "${lastIngest.keyword}"` : ''}
          </span>
          <button
            className="btn sm gh"
            onClick={() => (window.location.href = '/products')}
            style={{ marginLeft: 'auto' }}
          >
            ไปตรวจ
          </button>
        </div>
      ) : (
        <div className="warn">
          <Ic n="warn" s={20} />
          ยังไม่มีข้อมูลจาก extension — เปิด Shopee → popup → Market → Send API
        </div>
      )}

      {/* ─── Stats cards (จาก API จริง) ─── */}
      {stats && (
        <div className="g" style={{ marginBottom: 16 }}>
          {(
            [
              [stats.total, 'สินค้าทั้งหมด', 'var(--ink)'],
              [stats.pending, 'รอตรวจ', 'var(--warn, #f5a623)'],
              [stats.approved, 'อนุมัติแล้ว', 'var(--ok, #0a7)'],
              [stats.rejected, 'ปฏิเสธ', 'var(--mute)'],
            ] as [number, string, string][]
          ).map(([v, l, c]) => (
            <div key={l} className="card" style={{ flex: 1, minWidth: 140 }}>
              <b style={{ fontSize: 26, color: c }}>{v}</b>
              <div className="m">{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Source cards (static — ไม่มี mock run) ─── */}
      <div className="g">
        <SourceCard
          name="Shopee"
          platform="shopee"
          sub="ผ่าน Chrome Extension"
          status="active"
        />
        <SourceCard name="TikTok Shop" platform="tiktok" sub="ยังไม่รองรับ" status="soon" />
        <SourceCard name="Lazada" platform="lazada" sub="ยังไม่รองรับ" status="soon" />
      </div>

      <div className="g" style={{ alignItems: 'flex-start' }}>
        {/* ─── API info ─── */}
        <div className="card" style={{ maxWidth: 520 }}>
          <h3>รับข้อมูลผ่าน API</h3>
          <label className="f">
            Endpoint
            <div className="row">
              <input className="in" readOnly value="POST /api/ingest" />
              <button
                className="btn gh"
                onClick={() => {
                  navigator.clipboard?.writeText('POST /api/ingest');
                  showToast('คัดลอกแล้ว');
                }}
              >
                <Ic n="copy" s={16} /> คัดลอก
              </button>
            </div>
          </label>
          <label className="f">
            API key
            <div className="row">
              <input className="in" readOnly value={maskKey()} />
              <button
                className="btn gh"
                onClick={() => {
                  regenKey();
                  showToast('สร้าง API key ใหม่แล้ว (local)');
                }}
              >
                <Ic n="refresh" s={16} /> สร้างใหม่
              </button>
            </div>
            <div className="m" style={{ marginTop: 6, fontSize: 12 }}>
              ⚠️ endpoint ยังไม่ตรวจ auth — ตั้ง <code>PI_INGEST_API_KEY</code> ใน{' '}
              <code>.env.local</code> เพื่อเปิดใช้
            </div>
          </label>
          <div className="code">
            <span className="k">curl</span> -X POST https://api.pi.app/api/ingest \{'\n'}
            {'  '}-H <span className="s">&quot;Content-Type: application/json&quot;</span> \{'\n'}
            {'  '}-d @products.json
          </div>
          <div className="m">
            ระบบจับคู่ด้วย external_id ไม่สร้างซ้ำ · ทุกรายการใหม่เข้าคิว &quot;รอตรวจ&quot;
            ก่อนขึ้น Feed
          </div>
        </div>

        {/* ─── Jobs + กติกา ─── */}
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="row sp" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>งานล่าสุด</h3>
              <span className="m" style={{ fontSize: 12 }}>
                {jobs.length} รายการ · auto-refresh 15s
              </span>
            </div>
            {jobs.length === 0 ? (
              <div
                className="m"
                style={{ textAlign: 'center', padding: 30, color: 'var(--mute)' }}
              >
                ยังไม่มีประวัติ — ส่งข้อมูลจาก extension เพื่อเริ่ม
              </div>
            ) : (
              <div className="tbw" style={{ boxShadow: 'none', margin: '0 -24px', borderRadius: 0 }}>
                <div className="tbl" style={{ minWidth: 420 }}>
                  <div
                    className="tr h"
                    style={
                      {
                        '--c': '64px 1.2fr 56px 64px 64px 96px',
                        minHeight: 40,
                      } as React.CSSProperties
                    }
                  >
                    <span>เวลา</span>
                    <span>Source</span>
                    <span>ใหม่</span>
                    <span>อัปเดต</span>
                    <span>ล้มเหลว</span>
                    <span>สถานะ</span>
                  </div>
                  {jobs.slice(0, 20).map((j, i) => {
                    const { label, tip } = formatSource(j.s);
                    return (
                      <div
                        key={i}
                        className="tr"
                        style={
                          {
                            '--c': '64px 1.2fr 56px 64px 64px 96px',
                            minHeight: 52,
                          } as React.CSSProperties
                        }
                      >
                        <span>{j.t}</span>
                        <b
                          title={tip}
                          style={{
                            display: 'block',
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}
                        </b>
                        <span>{j.n ? '+' + j.n : '—'}</span>
                        <span>{j.u || '—'}</span>
                        <span>{j.f}</span>
                        <Tag t={j.st} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <h3>กติกาเมื่อนำเข้า</h3>
            <label className="f">
              Dedupe key
              <select className="sel">
                <option>platform + external_id</option>
              </select>
            </label>
            {[
              'ทุกรายการใหม่เข้าคิว "รอตรวจ" อัตโนมัติ',
              'อัปเดตของเดิมจะคง status เดิมไว้',
              'แนะนำให้ตรวจสอบก่อนอนุมัติขึ้น Feed',
            ].map((t, i) => (
              <div key={i} className="row sp" style={{ fontWeight: 600, fontSize: 14 }}>
                <span>{t}</span>
                <button
                  className={'tgl ' + (opts[i] ? 'on' : '')}
                  onClick={() => toggleOpt(i)}
                >
                  <i />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── helper component ───
function SourceCard({
  name,
  platform,
  sub,
  status,
}: {
  name: string;
  platform: 'shopee' | 'tiktok' | 'lazada';
  sub: string;
  status: 'active' | 'soon';
}) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <div className="row">
        <div
          className="tile"
          style={{ width: 44, height: 44, borderRadius: 15, background: 'var(--soft)' }}
        >
          <Plat p={platform} z={26} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 17 }}>{name}</b>
          <div className="m">{sub}</div>
        </div>
      </div>
      <div
        className="m"
        style={{
          marginTop: 8,
          fontSize: 12,
          color: status === 'active' ? 'var(--ok)' : 'var(--mute)',
        }}
      >
        {status === 'active' ? '✅ ใช้งาน — ผ่าน Chrome Extension' : '🔜 ยังไม่รองรับ'}
      </div>
    </div>
  );
}