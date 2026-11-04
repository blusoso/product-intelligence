'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ic } from '@/components/icons';
import { useApp } from '@/lib/store';
import { PipelineCard } from '@/components/products/PipelineCard';
import { StepBar, type StepDef } from '@/components/network/StepBar';
import { StorageCard } from '@/components/network/StorageCard';
import { Glossary } from '@/components/network/Glossary';
import { Findings } from '@/components/network/Findings';
import { RecordsTable } from '@/components/network/RecordsTable';
import { GraphView } from '@/components/network/GraphView';
import { ConfigPanel } from '@/components/network/ConfigPanel';
import { ConflictQueue } from '@/components/network/ConflictQueue';
import { RunHistory } from '@/components/network/RunHistory';
import {
  cols,
  nf,
  scoreColor,
  sevColor,
  sevIcon,
  TH_DATETIME,
  verdict,
  type AuditPayload,
  type AuditRunRow,
  type AttributeCoverageRow,
  type AutoRunFileView,
  type AutoRunPayload,
  type BuildPayload,
  type ConfigPayload,
  type ConfigPreset,
  type GraphPayload,
  type PipelineConfig,
  type RunWithDelta,
  type Source,
  type StepId,
  } from '@/components/network/shared';

type Tab = 'data' | 'graph' | 'history';

const SOURCE_CARDS: Array<{ id: Source; title: string; sub: string; pros: string; cons: string }> = [
  {
    id: 'db',
    title: 'ฐานข้อมูล Supabase',
    sub: 'ตาราง products — ข้อมูลจริงจาก scraper',
    pros: 'ใช้ตัดสินใจได้จริง มีรูปและข้อมูลครบ',
    cons: 'การเขียนกลับต้องเลือกเองในขั้น 5',
  },
  {
    id: 'file',
    title: 'ไฟล์ data/products.json',
    sub: 'ไฟล์ตัวอย่างในเครื่อง',
    pros: 'ลองปรับ taxonomy ได้โดยไม่กระทบข้อมูลจริง',
    cons: 'ไม่มีรูป/ข้อมูลบางส่วน และ sync กลับ DB ไม่ได้',
  },
];

const EXPORT_PARTS: Array<{ id: string; label: string; desc: string }> = [
  { id: 'nodes', label: 'Nodes', desc: 'สินค้า ร้าน แบรนด์ หมวด จังหวัด' },
  { id: 'edges', label: 'Edges', desc: 'ความสัมพันธ์ทุกประเภทพร้อมน้ำหนัก' },
  { id: 'records', label: 'Products', desc: 'ข้อมูล normalize แล้ว 1 แถวต่อสินค้า' },
  { id: 'report', label: 'Audit report', desc: 'ผลตรวจคุณภาพและคะแนนรายมิติ' },
  { id: 'graph', label: 'Snapshot', desc: 'graph + report + records รวมกัน' },
  { id: 'opportunities', label: 'Opportunities', desc: 'Proven / Hidden / Emerging พร้อมเหตุผล' },
];

/** แปลงผลจากงานอัตโนมัติให้อยู่ในรูป AuditPayload ที่ UI ใช้อยู่ */
function auditFromAuto(last: AutoRunFileView): AuditPayload | null {
  if (!last.report_after || !last.report_before || !last.summary) return null;
  return {
    ok: true,
    source: last.source,
    label: last.label,
    note: last.note,
    summary: last.summary,
    report_before: last.report_before,
    report_after: last.report_after,
    dropped: last.dropped ?? [],
    merged: last.merged ?? [],
    changes: last.changes ?? [],
    records: last.records ?? [],
    projection: null,
    graph_built: false,
  };
}

export default function NetworkPage() {
  const { showToast } = useApp();

  const [step, setStep] = useState<StepId>(1);
  const [tab, setTab] = useState<Tab>('data');
  const [source, setSource] = useState<Source>('db');

  const [cfg, setCfg] = useState<PipelineConfig | null>(null);
  const [savedCfg, setSavedCfg] = useState<PipelineConfig | null>(null);
  const [presets, setPresets] = useState<ConfigPreset[]>([]);
  const [cfgUpdatedAt, setCfgUpdatedAt] = useState<string | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const [audit, setAudit] = useState<AuditPayload | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showFindings, setShowFindings] = useState(false);

  const [build, setBuild] = useState<BuildPayload | null>(null);
  const [building, setBuilding] = useState(false);

  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunWithDelta[]>([]);

  const [auto, setAuto] = useState<AutoRunPayload | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [syncingGraph, setSyncingGraph] = useState(false);
  const [coverage, setCoverage] = useState<AttributeCoverageRow[]>([]);
  const [auditRuns, setAuditRuns] = useState<AuditRunRow[]>([]);

  const dirty = Boolean(cfg && savedCfg && JSON.stringify(cfg) !== JSON.stringify(savedCfg));

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/network/config', { cache: 'no-store' });
      const json = (await res.json()) as ConfigPayload;
      if (!json.ok) throw new Error('config failed');
      setCfg(json.config);
      setSavedCfg(json.config);
      setPresets(json.presets);
      setCfgUpdatedAt(json.updated_at);
    } catch {
      showToast('โหลดค่าตั้งไม่สำเร็จ — ใช้ค่าเริ่มต้นแทน');
    }
  }, [showToast]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/network/runs?limit=20', { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; runs: RunWithDelta[] };
      if (json.ok) setRuns(json.runs);
    } catch {
      /* ประวัติว่างได้ ไม่ใช่ error ที่ต้องรบกวน */
    }
  }, []);

  const loadAuto = useCallback(async (opts?: { prefill?: boolean }) => {
    try {
      const res = await fetch('/api/network/auto-run', { cache: 'no-store' });
      const json = (await res.json()) as AutoRunPayload;
      if (!json.ok) return;
      setAuto(json);
      setAutoRunning(json.status === 'running');
      const mapped = json.last ? auditFromAuto(json.last) : null;
      if (mapped && opts?.prefill !== false) {
        setAudit((prev) => prev ?? mapped);
      }
    } catch {
      /* ไม่มีสถานะก็ไม่เป็นไร — ใช้ปุ่มตรวจเองได้ */
    }
  }, []);

  /** เริ่มประมวลผลใหม่ (ปุ่มในขั้น 5) — สถานะ/AI อยู่ใน PipelineCard ด้านบน */
  const rerunAuto = useCallback(async () => {
    setAutoRunning(true);
    try {
      const res = await fetch('/api/network/auto-run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'trigger failed');
      showToast('เริ่มประมวลผลเบื้องหลังแล้ว — ผลจะขึ้นในไม่กี่วินาที');
      await loadAuto({ prefill: false });
    } catch (e) {
      setAutoRunning(false);
      showToast(`เริ่มงานไม่สำเร็จ: ${(e as Error).message}`);
    }
  }, [loadAuto, showToast]);

  /** เขียน graph snapshot ล่าสุดลง Supabase (network_runs/nodes/edges) */
  const syncGraphDb = useCallback(async () => {
    setSyncingGraph(true);
    try {
      const res = await fetch('/api/network/sync-graph', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'sync graph ไม่สำเร็จ');
      showToast(
        `เขียนกราฟลง DB แล้ว · ${nf.format(json.nodes)} nodes / ${nf.format(json.edges)} edges`,
      );
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setSyncingGraph(false);
    }
  }, [showToast]);

  const loadCoverage = useCallback(async () => {
    try {
      const res = await fetch('/api/network/attributes/summary', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setCoverage((json.coverage ?? []) as AttributeCoverageRow[]);
    } catch {
      /* ไม่มีข้อมูลก็ไม่เป็นไร */
    }
  }, []);

  const loadAuditRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/network/audit-runs?limit=8', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) setAuditRuns((json.rows ?? []) as AuditRunRow[]);
    } catch {
      /* ยังไม่ apply migration ก็ว่างได้ */
    }
  }, []);

  const loadGraph = useCallback(async () => {
    setGraphError(null);
    try {
      const res = await fetch('/api/network/graph?limit=1200', { cache: 'no-store' });
      const json = (await res.json()) as GraphPayload;
      if (!json.ok) throw new Error(json.error ?? 'graph failed');
      setGraph(json);
    } catch (e) {
      setGraph(null);
      setGraphError((e as Error).message);
    }
  }, []);

  const runAudit = useCallback(
    async (src: Source) => {
      setAuditLoading(true);
      try {
        const res = await fetch(`/api/network/audit?source=${src}`, { cache: 'no-store' });
        const json = (await res.json()) as AuditPayload;
        if (!json.ok) throw new Error(json.error ?? 'audit failed');
        setAudit(json);
        setStep(2);
        showToast(`ตรวจแล้ว ${nf.format(json.summary.input)} รายการ · คะแนน ${json.report_after.score}`);
      } catch (e) {
        showToast(`ตรวจข้อมูลไม่ได้: ${(e as Error).message}`);
      } finally {
        setAuditLoading(false);
      }
    },
    [showToast],
  );

  const saveConfig = useCallback(async () => {
    if (!cfg) return;
    setSavingCfg(true);
    try {
      const res = await fetch('/api/network/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const json = (await res.json()) as ConfigPayload;
      if (!json.ok) throw new Error('save failed');
      setCfg(json.config);
      setSavedCfg(json.config);
      setCfgUpdatedAt(json.updated_at);
      showToast('บันทึกค่าตั้งแล้ว — การสร้างกราฟครั้งต่อไปใช้ค่านี้');
    } catch (e) {
      showToast(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSavingCfg(false);
    }
  }, [cfg, showToast]);

  const runBuild = useCallback(async () => {
    if (!cfg || building) return;
    setBuilding(true);
    try {
      const body: Record<string, unknown> = {
        ...cfg,
        source,
        apply: true,
      };

      const res = await fetch('/api/network/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as BuildPayload;
      if (!json.ok) throw new Error(json.error ?? 'build failed');
      setBuild(json);
      setAudit(json);
      setStep(4);
      showToast(
        `สร้างกราฟแล้ว · ${nf.format(json.summary.nodes)} nodes / ${nf.format(json.summary.edges)} edges`,
      );
      await Promise.all([loadGraph(), loadRuns()]);
      if (json.sync?.hint) showToast(json.sync.hint);
    } catch (e) {
      showToast(`สร้างกราฟไม่ได้: ${(e as Error).message}`);
    } finally {
      setBuilding(false);
    }
  }, [cfg, building, source, showToast, loadGraph, loadRuns]);

  useEffect(() => {
    loadConfig();
    loadRuns();
    loadAuto();
    loadCoverage();
    loadAuditRuns();
  }, [loadConfig, loadRuns, loadAuto, loadCoverage, loadAuditRuns]);

  // ระหว่างที่งานเบื้องหลังกำลังรัน ให้ถามสถานะเป็นระยะ
  useEffect(() => {
    if (!autoRunning) return;
    const t = setInterval(() => loadAuto({ prefill: true }), 3000);
    return () => clearInterval(t);
  }, [autoRunning, loadAuto]);

  useEffect(() => {
    setAudit(null);
    setBuild(null);
  }, [source]);

  const steps: StepDef[] = useMemo(
    () => [
      { id: 1, title: 'เลือกแหล่งข้อมูล', hint: 'Supabase หรือไฟล์ตัวอย่าง', done: Boolean(audit) },
      { id: 2, title: 'ตรวจคุณภาพ', hint: 'อัตโนมัติหลัง ingestion', done: Boolean(audit) },
      { id: 3, title: 'ตั้งค่าการประมวลผล', hint: 'ใช้กับงานอัตโนมัติรอบถัดไป', done: Boolean(cfg) },
      { id: 4, title: 'สร้างกราฟ', hint: 'ขั้นเดียวที่ต้องสั่งเอง', done: Boolean(build) },
      { id: 5, title: 'นำไปใช้', hint: 'export · DB เขียนอัตโนมัติแล้ว', done: Boolean(build?.sync) || Boolean(auto?.last?.sync && !auto.last.sync.skipped) },
    ],
    [audit, cfg, build, auto],
  );

  const topFindings = useMemo(() => {
    if (!audit) return [];
    const all = audit.report_after.sections.flatMap((s) => s.findings.map((f) => ({ ...f, section: s.title })));
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return all.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count).slice(0, 3);
  }, [audit]);

  const previous = build ? (runs.find((r) => r.id !== build.run.id) ?? null) : (runs[0] ?? null);

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">Home / Network</div>
          <h1>Network</h1>
          <div className="m" style={{ marginTop: 4 }}>
            แปลงข้อมูลสินค้าดิบให้พร้อมวิเคราะห์เครือข่าย — ตรวจ → ปรับ → สร้างกราฟ → export
          </div>
        </div>
        <div className="acts">
          <div className="seg" style={{ minWidth: 210 }}>
            {SOURCE_CARDS.map((c) => (
              <button
                key={c.id}
                className={source === c.id ? 'on' : ''}
                onClick={() => setSource(c.id)}
                disabled={building || auditLoading}
              >
                {c.id === 'db' ? 'Supabase' : 'ไฟล์'}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => runAudit(source)} disabled={auditLoading || building}>
            <Ic n="refresh" s={17} />
            {auditLoading ? 'กำลังตรวจ…' : 'ตรวจสอบข้อมูล'}
          </button>
        </div>
      </div>

      {/* ── สถานะการประมวลผล (การ์ดเดียวกับหน้า Products) ── */}
      <PipelineCard variant="lean" onUpdated={() => loadAuto({ prefill: false })} />



      <div className="m" style={{ fontSize: 12 }}>
        หลังนำเข้าข้อมูล ระบบประมวลผลให้อัตโนมัติ — สถานะ/ปุ่มสั่งงานอยู่ในหน้า Products ·
        ขั้นนี้เหลือแค่ “สร้างกราฟ” ที่ต้องสั่งเอง
      </div>

      <div className="g">
        <div style={{ flex: '2 1 520px', minWidth: 0 }}>
          <StepBar steps={steps} active={step} onSelect={setStep} />
        </div>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <StorageCard
            source={source}
            products={audit?.summary.input ?? build?.summary.kept ?? 0}
            snapshotAt={build?.run.at ?? null}
            snapshotPath={build?.snapshot ?? null}
            sync={build?.sync ?? null}
          />
        </div>
      </div>

      {/* ── ขั้น 1: แหล่งข้อมูล ─────────────────────────────── */}
      {step === 1 && (
        <div className="card">
          <h3>เลือกว่าจะตรวจข้อมูลชุดไหน</h3>
          <div className="g">
            {SOURCE_CARDS.map((c) => {
              const on = source === c.id;
              return (
                <div
                  key={c.id}
                  className="iss"
                  style={{
                    background: 'var(--bg)',
                    border: on ? '2px solid var(--ink)' : '2px solid transparent',
                    gap: 8,
                  }}
                >
                  <div className="row sp">
                    <b>{c.title}</b>
                    {on && <span className="tg t-lime">เลือกอยู่</span>}
                  </div>
                  <div className="m">{c.sub}</div>
                  <div className="m" style={{ fontSize: 12 }}>
                    ✅ {c.pros}
                    <br />⚠️ {c.cons}
                  </div>
                  <button
                    className={on ? 'btn sm' : 'btn sm gh'}
                    onClick={() => {
                      setSource(c.id);
                      runAudit(c.id);
                    }}
                    disabled={auditLoading}
                  >
                    ตรวจข้อมูลชุดนี้
                  </button>
                </div>
              );
            })}
          </div>
          <div className="m">
            ตรวจแล้วยังไม่แก้อะไร — ถ้าอยากปรับวิธีจัดกลุ่ม/จับคู่ ไปขั้น 3 · ถ้าอยากได้กราฟเลยไปขั้น 4
          </div>
        </div>
      )}

      {/* ── ขั้น 2: ตรวจคุณภาพ ──────────────────────────────── */}
      {step === 2 && (
        <>
          {!audit ? (
            <div className="card" style={{ alignItems: 'flex-start' }}>
              <h3>ยังไม่ได้ตรวจข้อมูล</h3>
              <div className="m">เริ่มจากกด “ตรวจสอบข้อมูล” ด้านบน หรือเลือกแหล่งข้อมูลในขั้น 1</div>
              <button className="btn" onClick={() => runAudit(source)} disabled={auditLoading}>
                <Ic n="refresh" s={17} /> ตรวจสอบข้อมูล
              </button>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="row sp" style={{ flexWrap: 'wrap', gap: 16 }}>
                  <div>
                    <div className="m">คะแนนคุณภาพ (หลัง normalize)</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                      <b style={{ fontSize: 48, color: scoreColor(audit.report_after.score) }}>
                        {audit.report_after.score}
                      </b>
                      <span className="m">
                        จาก 100 · ดิบ {audit.report_before.score} · เกรด {audit.report_after.grade}
                      </span>
                    </div>
                    <div className="tg" style={{ background: 'var(--bg)', color: verdict(audit.report_after.score).tone }}>
                      {verdict(audit.report_after.score).label}
                    </div>
                    <div className="m" style={{ marginTop: 6 }}>
                      {verdict(audit.report_after.score).hint}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8, minWidth: 260 }}>
                    <div className="row sp">
                      <span className="m">รายการที่ตรวจ</span>
                      <b>{nf.format(audit.summary.input)}</b>
                    </div>
                    <div className="row sp">
                      <span className="m">ผ่านเข้า graph</span>
                      <b>{nf.format(audit.summary.kept)}</b>
                    </div>
                    <div className="row sp">
                      <span className="m">ถูกตัด / รวม</span>
                      <b>
                        {nf.format(audit.summary.dropped)} / {nf.format(audit.summary.merged)}
                      </b>
                    </div>
                    <div className="row sp">
                      <span className="m">ความพร้อมของกราฟ</span>
                      <b style={{ color: scoreColor(audit.summary.readiness) }}>{audit.summary.readiness}%</b>
                    </div>
                  </div>
                </div>
              </div>

              {coverage.length > 0 && (
                <div className="card">
                  <h3>
                    <span>ความครอบคลุม Attributes (หลักฐาน vs AI)</span>
                    <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
                      {nf.format(coverage[0]?.total ?? 0)} รายการ · ตัวเลข = จำนวนสินค้าที่มีค่านั้น
                    </span>
                  </h3>
                  <div className="tbw">
                    <div className="tbl" style={{ minWidth: 560 }}>
                      <div className="tr h" style={cols('1fr 90px 110px 90px 80px')}>
                        <span>attribute</span>
                        <span>หลักฐาน</span>
                        <span>AI อนุมาน</span>
                        <span>คนแก้</span>
                        <span>ว่าง</span>
                      </div>
                      {coverage.map((c) => (
                        <div key={c.attribute} className="tr" style={cols('1fr 90px 110px 90px 80px')}>
                          <span>
                            {c.label} <span className="m">{c.attribute}</span>
                          </span>
                          <span>{nf.format(c.evidence)}</span>
                          <span style={{ color: '#8B3FAE', fontWeight: 700 }}>{nf.format(c.ai)}</span>
                          <span style={{ color: 'var(--lilT)', fontWeight: 700 }}>{nf.format(c.manual ?? 0)}</span>
                          <span className="m">{nf.format(c.none)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="m" style={{ fontSize: 12 }}>
                    ค่าที่มาจาก AI มีป้าย “AI” · ค่าที่คนแก้มีป้าย “คนแก้” — แยกจากหลักฐานเสมอ (ดูรายละเอียดต่อสินค้าที่หน้า Products)
                  </div>
                </div>
              )}

              {auditRuns.length > 0 && (
                <div className="card">
                  <h3>
                    <span>ประวัติ Audit (บันทึกใน DB)</span>
                    <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
                      {auditRuns.length} รายการล่าสุด
                    </span>
                  </h3>
                  <div className="tbw">
                    <div className="tbl" style={{ minWidth: 640 }}>
                      <div className="tr h" style={cols('150px 90px 80px 80px 80px 90px 120px')}>
                        <span>เวลา</span>
                        <span>ที่มา</span>
                        <span>จำนวน</span>
                        <span>คะแนน</span>
                        <span>เกรด</span>
                        <span>readiness</span>
                        <span>critical/warn/info</span>
                      </div>
                      {auditRuns.map((r) => (
                        <div key={r.id} className="tr" style={cols('150px 90px 80px 80px 80px 90px 120px')}>
                          <span className="m">{TH_DATETIME(r.at)}</span>
                          <span className="tg t-mut">{r.kind}</span>
                          <span>{nf.format(r.total)}</span>
                          <span style={{ color: scoreColor(r.score), fontWeight: 800 }}>{r.score}</span>
                          <span>{r.grade}</span>
                          <span>{r.readiness}%</span>
                          <span className="m">
                            {r.summary?.critical ?? 0}/{r.summary?.warning ?? 0}/{r.summary?.info ?? 0}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="m" style={{ fontSize: 12 }}>
                    บันทึกอัตโนมัติเมื่อ ingestion / สร้างกราฟ / เติม AI · query ต่อได้ที่ view <code>network_audit_findings</code>
                  </div>
                </div>
              )}

              {topFindings.length > 0 && (
                <div className="card">
                  <h3>
                    <span>สิ่งที่ควรแก้ก่อน</span>
                    <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
                      เรียงตามความรุนแรง
                    </span>
                  </h3>
                  {topFindings.map((f) => (
                    <div
                      key={f.id}
                      className="iss"
                      style={{ background: 'var(--bg)', borderLeft: `4px solid ${sevColor(f.severity)}` }}
                    >
                      <div className="row sp">
                        <b>
                          {sevIcon(f.severity)} {f.title}
                        </b>
                        <span className="tg t-mut">{nf.format(f.count)} รายการ</span>
                      </div>
                      <div className="m" style={{ fontSize: 12 }}>
                        {f.section} · {f.description}
                      </div>
                    </div>
                  ))}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn sm gh" onClick={() => setShowFindings((v) => !v)}>
                      <Ic n="eye" s={16} /> {showFindings ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดทั้งหมด'}
                    </button>
                    <button className="btn sm" onClick={() => setStep(3)}>
                      ไปตั้งค่าการประมวลผล
                    </button>
                  </div>
                </div>
              )}

              {showFindings && (
                <Findings report={audit.report_after} dropped={audit.dropped} merged={audit.merged} />
              )}
            </>
          )}
        </>
      )}

      {/* ── ขั้น 3: ตั้งค่า ──────────────────────────────────── */}
      {step === 3 && (
        <>
          {!cfg ? (
            <div className="card">กำลังโหลดค่าตั้ง…</div>
          ) : (
            <ConfigPanel
              config={cfg}
              presets={presets}
              updatedAt={cfgUpdatedAt}
              saving={savingCfg}
              dirty={dirty}
              onChange={(patch) => setCfg((prev) => (prev ? { ...prev, ...patch } : prev))}
              onSave={saveConfig}
            />
          )}
          <div className="card row sp" style={{ flexWrap: 'wrap' }}>
            <div className="m">
              ค่าที่บันทึกจะมีผลกับการสร้างกราฟครั้งถัดไป และถูกบันทึกในประวัติการรันทุกครั้ง
            </div>
            <button className="btn" onClick={() => setStep(4)} disabled={dirty}>
              <Ic n="nodes" s={17} /> ไปสร้างกราฟ
            </button>
          </div>
        </>
      )}

      {/* ── ขั้น 4: สร้างกราฟ ───────────────────────────────── */}
      {step === 4 && (
        <>
          <div className="card">
            <h3>
              <span>สร้างกราฟและบันทึก snapshot</span>
              <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
                {cfg ? `dedupe:${cfg.dedupe} · เกณฑ์ ${cfg.similarity_threshold.toFixed(2)} · nb ${cfg.max_neighbors}` : ''}
              </span>
            </h3>
            <div className="m">
              ระบบจะรวมรายการซ้ำ → normalize → สร้าง nodes/edges → บันทึกเป็นไฟล์ snapshot
              (ไม่แตะฐานข้อมูลเว้นแต่เลือกเขียน DB ในขั้น 5)
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => runBuild()} disabled={building || !cfg || dirty}>
                <Ic n="nodes" s={17} /> {building ? 'กำลังสร้าง…' : 'สร้างกราฟและบันทึก'}
              </button>
              {dirty && <span className="m">มีค่าที่แก้แล้วยังไม่บันทึก — ไปบันทึกที่ขั้น 3 ก่อน</span>}
            </div>
            {build && (
              <div className="g" style={{ marginTop: 4 }}>
                {[
                  ['สินค้าเข้า → ผ่าน', `${nf.format(build.summary.input)} → ${nf.format(build.summary.kept)}`],
                  ['Nodes / Edges', `${nf.format(build.summary.nodes)} / ${nf.format(build.summary.edges)}`],
                  [
                    'ตีความสินค้า (use case)',
                    (() => {
                      const sec = build.report_after?.sections.find((s) => s.id === 'enrichment');
                      const total = build.report_after?.total ?? 0;
                      const miss = sec?.findings.find((f) => f.id === 'enrichment_missing_use_case')?.count ?? 0;
                      return total ? `${Math.round(((total - miss) / total) * 100)}%` : '—';
                    })(),
                  ],
                  ['ความพร้อม', `${build.summary.readiness}%`],
                  [
                    'Trust Gate',
                    (() => {
                      const g = build.summary.gate ?? auto?.last?.summary?.gate;
                      if (!g) return '—';
                      const r = build.summary.risk ?? auto?.last?.summary?.risk;
                      return `${nf.format(g.pass)} ผ่าน · ${nf.format(g.review)} ตรวจ · ${nf.format(g.blocked)} บล็อก${
                        r ? ` · เสี่ยงสูง ${nf.format(r.high)}` : ''
                      }`;
                    })(),
                  ],
                  [
                    'เทียบครั้งก่อน',
                    previous
                      ? `${build.summary.readiness - previous.readiness >= 0 ? '+' : ''}${build.summary.readiness - previous.readiness} readiness`
                      : 'ยังไม่มีครั้งก่อน',
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="kpi" style={{ minWidth: 160, boxShadow: 'none', background: 'var(--bg)' }}>
                    <div className="m">{label}</div>
                    <b style={{ fontSize: 22, lineHeight: '30px' }}>{value}</b>
                  </div>
                ))}
              </div>
            )}
            {build && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm gh" onClick={() => setTab('graph')}>
                  <Ic n="nodes" s={16} /> ดูกราฟเต็ม
                </button>
                <button className="btn sm" onClick={() => setStep(5)}>
                  ไปนำไปใช้
                </button>
              </div>
            )}
          </div>

          <GraphView
            graph={graph}
            error={graphError}
            onBuild={() => runBuild()}
            building={building}
            compact
          />
        </>
      )}

      {/* ── ขั้น 5: นำไปใช้ ─────────────────────────────────── */}
      {step === 5 && (
        <>
          <div className="card">
            <h3>
              <span>ส่งออกข้อมูล</span>
              <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
                CSV เปิดใน Excel ได้ (มี BOM ภาษาไทย)
              </span>
            </h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {EXPORT_PARTS.map((p) => {
                const needsGraph =
                  p.id === 'nodes' || p.id === 'edges' || p.id === 'graph' || p.id === 'opportunities';
                const disabled = needsGraph ? !build : !(build || auto?.last);
                return (
                  <div key={p.id} className="iss" style={{ background: 'var(--bg)' }}>
                    <div className="row sp">
                      <b>{p.label}</b>
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          className="btn sm gh"
                          onClick={() => download(p.id, 'csv')}
                          disabled={disabled}
                          title={needsGraph && !build ? 'ต้องสร้างกราฟก่อน (ขั้น 4)' : undefined}
                        >
                          <Ic n="down" s={15} /> CSV
                        </button>
                        <button className="btn sm" onClick={() => download(p.id, 'json')} disabled={disabled}>
                          <Ic n="file" s={15} /> JSON
                        </button>
                      </div>
                    </div>
                    <div className="m">{p.desc}</div>
                  </div>
                );
              })}
            </div>
            <div className="m" style={{ fontSize: 12 }}>
              snapshot: {build?.snapshot ? <code>{build.snapshot}</code> : 'ยังไม่มี — สร้างที่ขั้น 4 (records/report ดาวน์โหลดได้จากการประมวลผลอัตโนมัติ)'}
            </div>
          </div>

          <div className="card">
            <h3>เขียนกลับฐานข้อมูล</h3>
            <div className="m">
              ระบบเขียน <code>products</code> ให้อัตโนมัติหลัง ingestion (core + normalized + enrichment + ai_enrichment)
              — ไม่แตะ <code>status</code>/<code>sku</code> ของแอดมิน
            </div>
            <div className="m" style={{ fontSize: 13 }}>
              ล่าสุด:{' '}
              {auto?.last?.sync
                ? auto.last.sync.skipped
                  ? `ข้าม (${auto.last.sync.note ?? 'แหล่งข้อมูลไม่ใช่ DB'})`
                  : `อัปเดต ${auto.last.sync.updated} แถว${auto.last.sync.failed ? ` · ล้มเหลว ${auto.last.sync.failed}` : ''}`
                : 'ยังไม่มีข้อมูล'}
              {auto?.last?.ai?.enabled
                ? ` · AI: เรียก ${auto.last.ai.called}, cache ${auto.last.ai.cached}${auto.last.ai.invalid ? `, ทิ้ง ${auto.last.ai.invalid}` : ''}`
                : ' · AI: ปิด (ไม่มี AI_API_KEY หรือปิดในค่าตั้ง)'}
            </div>
            {auto?.last?.sync?.hint ? (
              <div className="warn" style={{ fontSize: 13 }}>
                <Ic n="warn" s={16} /> {auto.last.sync.hint}
              </div>
            ) : null}
            <div className="row sp" style={{ flexWrap: 'wrap' }}>
              <span className="m" style={{ fontSize: 12 }}>
                ต้องการรันใหม่หลังแก้ค่าตั้ง/แก้ข้อมูลดิบ → กด “ประมวลผลใหม่” (หน้า Products หรือการ์ดด้านบน)
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn sm gh"
                  onClick={syncGraphDb}
                  disabled={syncingGraph || !build}
                  title={!build ? 'ต้องสร้างกราฟก่อน (ขั้น 4)' : 'เขียน network_runs/nodes/edges ชุดล่าสุดลง Supabase'}
                >
                  <Ic n="nodes" s={16} /> {syncingGraph ? 'กำลังเขียน…' : 'เขียนกราฟลง DB'}
                </button>
                <button className="btn sm gh" onClick={rerunAuto} disabled={autoRunning || auto?.enabled === false}>
                  <Ic n="refresh" s={16} /> {autoRunning ? 'กำลังทำงาน…' : 'ประมวลผลใหม่'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── ข้อมูลเชิงลึก ───────────────────────────────────── */}
      <div className="seg" style={{ maxWidth: 520 }}>
        {(
          [
            ['data', 'ข้อมูลสินค้า'],
            ['graph', 'กราฟ'],
            ['history', 'ประวัติการรัน'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? 'on' : ''}
            onClick={() => {
              setTab(id);
              if (id === 'graph' && !graph) loadGraph();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'data' && (
        <>
          <ConflictQueue />
          <RecordsTable records={build?.records ?? audit?.records ?? []} changes={build?.changes ?? audit?.changes ?? []} />
        </>
      )}
      {tab === 'graph' && (
        <GraphView graph={graph} error={graphError} onBuild={() => runBuild()} building={building} />
      )}
      {tab === 'history' && (
        <RunHistory
          runs={runs}
          onReuse={(run) => {
            setCfg(run.config);
            setStep(3);
            showToast(`ใช้ค่าเดิมจาก ${TH_DATETIME(run.at)} — กดบันทึกค่าตั้งเพื่อใช้งาน`);
          }}
        />
      )}

      <Glossary />
    </>
  );
}

async function download(part: string, format: 'json' | 'csv') {
  try {
    const res = await fetch(`/api/network/export?part=${part}&format=${format}`, { cache: 'no-store' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({} as any));
      alert(json?.error ?? `ดาวน์โหลดไม่ได้ (HTTP ${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pi-network-${part}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`ดาวน์โหลดไม่ได้: ${(e as Error).message}`);
  }
}
