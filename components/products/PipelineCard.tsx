'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Ic } from '@/components/icons';
import { useApp } from '@/lib/store';
import {
  nf,
  TH_DATETIME,
  type AiBackfillEventView,
  type AiBackfillResultView,
  type AutoRunPayload,
} from '@/components/network/shared';

/** สถานะ progress ของการเติม AI */
interface AiProg {
  kind: 'prep' | 'run' | 'wrap' | 'done' | 'err';
  phase?: 'calling' | 'second_pass' | 'focus' | 'vision';
  label: string;
  done: number;
  total: number;
  batches_done: number;
  batches_total: number;
  called: number;
  cached: number;
  failed: number;
  tokens: number;
  cost_usd: number;
  focus_total?: number;
  focus_done?: number;
  /** จำนวนค่าที่ได้จากการอ่านภาพในรอบนี้ */
  visionTags?: number;
  started_at: number;
  elapsed_ms: number;
  error?: string;
  result?: { processed: number; remaining: number; stopped?: boolean };
}

/** 12.3 วิ / 1.4 นาที */
export function fmtDur(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} วิ`;
  return `${(s / 60).toFixed(1)} นาที`;
}

const STATUS_TAG = (auto: AutoRunPayload | null) => {
  if (auto?.status === 'running') return { text: 'กำลังทำงาน', cls: 't-amb' };
  if (auto?.status === 'failed') return { text: 'ล้มเหลว', cls: 't-bad' };
  if (auto?.status === 'done') return { text: 'สำเร็จ', cls: 't-lime' };
  return { text: 'ยังไม่เคยรัน', cls: 't-mut' };
};

/**
 * การ์ดสถานะ "ประมวลผลอัตโนมัติ" + ปุ่มเติม AI (พร้อม progress สด)
 * ใช้ที่หน้า Products (ตัวเต็ม) และหน้า Network (แบบบรรทัดเดียว)
 */
export function PipelineCard({
  variant = 'full',
  onUpdated,
}: {
  variant?: 'full' | 'lean';
  onUpdated?: () => void;
}) {
  const { showToast } = useApp();
  const [auto, setAuto] = useState<AutoRunPayload | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProg, setAiProg] = useState<AiProg | null>(null);
  const [aiNow, setAiNow] = useState(0);
  const aiAbort = useRef<AbortController | null>(null);

  const loadAuto = useCallback(async () => {
    try {
      const res = await fetch('/api/network/auto-run?slim=1', { cache: 'no-store' });
      const json = (await res.json()) as AutoRunPayload;
      if (!json.ok) return;
      setAuto(json);
      setAutoRunning(json.status === 'running');
    } catch {
      /* ไม่มีสถานะก็ใช้ปุ่มตรวจเองได้ */
    }
  }, []);

  useEffect(() => {
    loadAuto();
  }, [loadAuto]);

  // ระหว่างงานเบื้องหลังรัน ให้ถามสถานะเป็นระยะ
  useEffect(() => {
    if (!autoRunning) return;
    const t = setInterval(loadAuto, 3000);
    return () => clearInterval(t);
  }, [autoRunning, loadAuto]);

  // tick ให้เวลาบนแถบเดิน
  useEffect(() => {
    if (!aiBusy) return;
    const t = setInterval(() => setAiNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [aiBusy]);

  const enrichAi = useCallback(
    async (mode: 'text' | 'vision', force = false) => {
      if (aiBusy) return;
      const modeLabel = mode === 'vision' ? 'อ่านภาพ' : 'AI';
      if (
        force &&
        !confirm(
          mode === 'vision'
            ? 'เรียกอ่านภาพใหม่ทั้งหมดหรือไม่?\n(รูปเดิมจะใช้ผลจาก cache ถ้า model/คำสั่งไม่เปลี่ยน)'
            : 'ข้อมูล AI ครบทุกรายการแล้ว — เรียก AI ใหม่ทั้งหมดหรือไม่?\n(ถ้า model/คำสั่งไม่เปลี่ยน ระบบจะใช้ผลเดิม ไม่เสียค่าใช้จ่าย)',
        )
      ) {
        return;
      }
      const started = Date.now();
      const missing =
        mode === 'vision' ? (auto?.last?.summary?.vision_missing ?? 0) : (auto?.ai?.missing ?? 0);
      const ctrl = new AbortController();
      aiAbort.current = ctrl;
      setAiBusy(true);
      setAiNow(started);

      const base: AiProg = {
        kind: 'prep',
        label: mode === 'vision' ? 'กำลังเตรียมรูปภาพ…' : 'กำลังเตรียมข้อมูล…',
        done: 0,
        total: missing,
        batches_done: 0,
        batches_total: 0,
        called: 0,
        cached: 0,
        failed: 0,
        tokens: 0,
        cost_usd: 0,
        started_at: started,
        elapsed_ms: 0,
      };
      setAiProg(base);

      const apply = (ev: AiBackfillEventView) => {
        setAiProg((prev) => {
          const p = prev ?? base;
          if (ev.type === 'stage') {
            if (ev.stage === 'vision') {
              return { ...p, kind: 'run', phase: 'vision', label: ev.label, total: ev.total ?? p.total };
            }
            return {
              ...p,
              kind: ev.stage === 'sync' || ev.stage === 'audit' ? 'wrap' : 'prep',
              label: ev.label,
              total: ev.total ?? p.total,
            };
          }
          if (ev.type === 'vision_progress') {
            return {
              ...p,
              kind: 'run',
              phase: 'vision',
              done: ev.progress.done,
              total: ev.progress.total,
              called: ev.progress.called,
              cached: ev.progress.cached,
              failed: ev.progress.failed,
              visionTags: ev.progress.tags,
              elapsed_ms: ev.progress.elapsed_ms,
            };
          }
          if (ev.type === 'progress') {
            return {
              ...p,
              kind: 'run',
              phase: ev.phase,
              done: ev.done,
              total: ev.total,
              batches_done: ev.batches_done,
              batches_total: ev.batches_total,
              called: ev.called,
              cached: ev.cached,
              failed: ev.failed,
              tokens: ev.tokens.prompt + ev.tokens.completion,
              cost_usd: ev.cost_usd,
              elapsed_ms: ev.elapsed_ms,
              focus_total: ev.focus_total,
              focus_done: ev.focus_done,
            };
          }
          if (ev.type === 'done') {
            const r = ev.result;
            if (!r.ok) return { ...p, kind: 'err', label: 'ผิดพลาด', error: r.error ?? 'AI ยังไม่พร้อม' };
            return {
              ...p,
              kind: 'done',
              label: r.stopped ? 'หยุดแล้ว' : 'เสร็จแล้ว',
              done: r.stopped ? p.done : Math.max(p.done, p.total),
              phase: undefined,
              result: { processed: r.processed, remaining: r.remaining, stopped: r.stopped },
            };
          }
          return { ...p, kind: 'err', label: 'ผิดพลาด', error: ev.error };
        });
      };

      let final: AiBackfillResultView | null = null;
      try {
        const res = await fetch(`/api/network/enrich-ai?stream=1&phase=${mode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(force ? { force: true } : {}),
          signal: ctrl.signal,
        });
        const ctype = res.headers.get('content-type') ?? '';
        if (!res.ok || !ctype.includes('ndjson') || !res.body) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error ?? `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx = buf.indexOf('\n');
          while (idx >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            idx = buf.indexOf('\n');
            if (!line) continue;
            let ev: AiBackfillEventView;
            try {
              ev = JSON.parse(line) as AiBackfillEventView;
            } catch {
              continue;
            }
            apply(ev);
            if (ev.type === 'done') final = ev.result;
            if (ev.type === 'error') throw new Error(ev.error);
          }
        }

        const r = final as AiBackfillResultView | null;
        if (!r) throw new Error('การเชื่อมต่อจบแต่ไม่ได้ผลลัพธ์');
        if (!r.ok) showToast(`เติมข้อมูล${modeLabel}ไม่สำเร็จ: ${r.error ?? 'ไม่ทราบสาเหตุ'}`);
        else if (r.stopped) showToast(`หยุดแล้ว — บันทึกผลที่เติมไป ${r.processed} รายการ`);
        else showToast(`เติมข้อมูล${modeLabel}แล้ว ${r.processed} รายการ · ยังไม่ได้ ${r.remaining}`);

        await loadAuto();
        onUpdated?.();
        window.setTimeout(() => setAiProg(null), 10000);
      } catch (e) {
        const err = e as Error;
        if (err.name === 'AbortError') {
          setAiProg((p) => (p ? { ...p, kind: 'done', label: 'หยุดแล้ว', phase: undefined } : p));
          showToast('หยุดแล้ว — ผลที่เติมไปถูกบันทึกไว้แล้ว');
          await loadAuto();
          onUpdated?.();
        } else {
          setAiProg((p) => (p ? { ...p, kind: 'err', label: 'ผิดพลาด', error: err.message } : p));
          showToast(`เติมข้อมูล${modeLabel}ไม่สำเร็จ: ${err.message}`);
        }
      } finally {
        aiAbort.current = null;
        setAiNow(Date.now());
        setAiBusy(false);
      }
    },
    [aiBusy, auto?.ai?.missing, auto?.last?.summary?.vision_missing, loadAuto, onUpdated, showToast],
  );

  const stopAi = useCallback(() => aiAbort.current?.abort(), []);

  const testAi = useCallback(async () => {
    try {
      const res = await fetch('/api/network/ai/health', { cache: 'no-store' });
      const json = await res.json();
      if (!json.available) {
        showToast(`AI ปิดอยู่: ${json.hint ?? 'ยังไม่ได้ตั้ง AI_API_KEY'}`);
        return;
      }
      if (json.ok) showToast(`AI พร้อมใช้งาน: ${json.provider}/${json.model} · ${json.check?.latency_ms ?? '?'} ms`);
      else showToast(`AI ยังใช้งานไม่ได้: ${json.check?.error ?? 'ไม่ทราบสาเหตุ'}`);
    } catch (e) {
      showToast(`ทดสอบ AI ไม่ได้: ${(e as Error).message}`);
    }
  }, [showToast]);

  const rerunAuto = useCallback(async () => {
    setAutoRunning(true);
    try {
      const res = await fetch('/api/network/auto-run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'เริ่มงานไม่สำเร็จ');
      showToast('เริ่มประมวลผลใหม่แล้ว — ผลจะขึ้นในไม่กี่วินาที');
      await loadAuto();
      onUpdated?.();
    } catch (e) {
      setAutoRunning(false);
      showToast(`เริ่มงานไม่สำเร็จ: ${(e as Error).message}`);
    }
  }, [loadAuto, onUpdated, showToast]);

  /* ── ตัวเลขที่ใช้แสดง ─────────────────────────────────────── */
  const status = STATUS_TAG(auto);
  const ai = auto?.ai;
  const aiMissing = ai?.missing ?? 0;
  const aiFailed = ai?.failed ?? 0;
  const lastAi = auto?.last?.ai ?? null;
  const lastVision = auto?.last?.vision ?? null;
  const vision = ai?.vision;
  const visionMissing = auto?.last?.summary?.vision_missing ?? 0;
  const phraseValues = auto?.last?.summary?.phrase_values ?? 0;
  const conflictPending = auto?.last?.summary?.conflict_pending ?? 0;

  const aiSummary = !ai?.available
    ? 'AI ปิดอยู่ — ยังไม่ได้ตั้ง AI_API_KEY'
    : aiMissing > 0
      ? `AI ยังไม่ได้ข้อมูลอีก ${nf.format(aiMissing)} รายการ${aiFailed ? ` (ตอบไม่สำเร็จ ${nf.format(aiFailed)})` : ''}`
      : 'ข้อมูล AI ครบแล้ว';

  const visionSummary = !vision?.available
    ? 'อ่านภาพปิดอยู่ — ยังไม่ได้ตั้ง AI_API_KEY / VISION_API_KEY'
    : visionMissing > 0
      ? `ยังไม่ได้อ่านภาพอีก ${nf.format(visionMissing)} รายการ`
      : 'อ่านภาพครบแล้ว';

  const pct = aiProg
    ? aiProg.total > 0
      ? Math.min(100, Math.round((aiProg.done / aiProg.total) * 100))
      : aiProg.kind === 'done'
        ? 100
        : 4
    : 0;
  const elapsed = aiProg ? Math.max(aiProg.elapsed_ms, (aiNow || Date.now()) - aiProg.started_at) : 0;
  const isVisionRun = aiProg?.phase === 'vision';
  const phaseLabel =
    aiProg?.kind === 'err'
      ? 'ผิดพลาด'
      : aiProg?.kind === 'done'
        ? aiProg.label
        : aiProg?.kind === 'run'
          ? aiProg.phase === 'second_pass'
            ? 'เก็บตก'
            : aiProg.phase === 'focus'
              ? 'เก็บค่าเฉพาะทาง'
              : aiProg.phase === 'vision'
                ? 'อ่านภาพ'
                : 'กำลังเรียก AI'
          : aiProg?.kind === 'wrap'
            ? 'บันทึกผล'
            : 'เตรียมข้อมูล';
  const hint = (() => {
    if (!aiProg) return '';
    if (aiProg.kind === 'err') return aiProg.error ?? 'ไม่ทราบสาเหตุ';
    if (aiProg.kind === 'done') {
      const r = aiProg.result;
      if (!r) return aiProg.label;
      return r.stopped
        ? `หยุดกลางทาง — บันทึกไปแล้ว ${nf.format(r.processed)} รายการ · ยังเหลือ ${nf.format(r.remaining)}`
        : `เติมข้อมูลแล้ว ${nf.format(r.processed)} รายการ · ยังเหลือ ${nf.format(r.remaining)} รายการ`;
    }
    if (aiProg.kind !== 'run') return aiProg.label;
    if (aiProg.phase === 'second_pass') {
      return `กำลังเก็บ use case/บริบทเพิ่ม · ${nf.format(aiProg.focus_done ?? 0)}/${nf.format(aiProg.focus_total ?? 0)} รายการ`;
    }
    if (aiProg.phase === 'vision') {
      const left = Math.max(0, aiProg.total - aiProg.done);
      return `อ่านรูปทีละสินค้า · เหลือ ${nf.format(left)} รายการ · ได้ ${nf.format(aiProg.visionTags ?? 0)} ค่า`;
    }
    const left = Math.max(0, aiProg.total - aiProg.done);
    const eta = aiProg.done > 0 ? fmtDur((elapsed / aiProg.done) * left) : '—';
    return `ทำทีละชุด · ชุดที่ ${aiProg.batches_done}/${aiProg.batches_total} · เหลือ ${nf.format(left)} รายการ (อีก ~${eta})`;
  })();

  const actions = (
    <>
      <button className="btn sm gh" onClick={testAi} title="ตรวจว่ากุญแจ/โมเดลใช้งานได้">
        ทดสอบ AI
      </button>
      <button
        className="btn sm gh"
        onClick={() => enrichAi('text', aiMissing === 0)}
        disabled={aiBusy || !ai?.available}
        title={
          !ai?.available
            ? 'ต้องตั้ง AI_API_KEY ใน .env แล้ว restart dev server'
            : aiMissing === 0
              ? 'ทุกแถวมีข้อมูล AI แล้ว — กดเพื่อเรียกใหม่ทั้งชุด (ใช้ผลเดิมถ้าไม่เปลี่ยน model/คำสั่ง)'
              : 'เติมข้อมูล AI ให้รายการที่ยังไม่มี'
        }
      >
        <Ic n="bolt" s={15} />{' '}
        {aiBusy && !isVisionRun
          ? `กำลังเติม… ${pct}%`
          : aiMissing
            ? `เติมข้อมูล AI (${nf.format(aiMissing)})`
            : 'เติมข้อมูล AI ซ้ำ'}
      </button>
      <button
        className="btn sm gh"
        onClick={() => enrichAi('vision', visionMissing === 0)}
        disabled={aiBusy || !vision?.available}
        title={
          !vision?.available
            ? 'ต้องตั้ง AI_API_KEY (DeepSeek อ่านภาพได้) หรือ VISION_API_KEY แล้ว restart dev server'
            : visionMissing === 0
              ? 'ทุกแถวที่มีรูปถูกอ่านแล้ว — กดเพื่ออ่านใหม่ (ใช้ cache ตาม URL รูป)'
              : 'อ่านรูปหน้าปกด้วย VLM เฉพาะแถวที่ยังไม่มีค่าจากภาพ'
        }
      >
        <Ic n="eye" s={15} />{' '}
        {aiBusy && isVisionRun
          ? `กำลังอ่านภาพ… ${pct}%`
          : visionMissing
            ? `อ่านภาพ (${nf.format(visionMissing)})`
            : 'อ่านภาพซ้ำ'}
      </button>
      <button className="btn sm" onClick={rerunAuto} disabled={autoRunning || aiBusy || auto?.enabled === false}>
        <Ic n="refresh" s={15} /> ประมวลผลใหม่
      </button>
    </>
  );

  const progressTitle = isVisionRun ? 'การอ่านภาพ' : 'การเติมข้อมูล AI';
  const progress = aiProg ? (
    <div className={`aiprog${aiProg.kind === 'done' ? ' done' : aiProg.kind === 'err' ? ' err' : ''}`}>
      <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>
            {aiProg.kind === 'err'
              ? `${progressTitle}ไม่สำเร็จ`
              : aiProg.kind === 'done'
                ? `${progressTitle}เสร็จสิ้น`
                : `กำลัง${progressTitle}`}
          </b>
          <span className={`tg ${aiProg.kind === 'err' ? 't-bad' : aiProg.kind === 'done' ? 't-lime' : 't-lil'}`}>{phaseLabel}</span>
          {aiProg.total > 0 ? (
            <span className="nm">
              {nf.format(aiProg.done)} / {nf.format(aiProg.total)} รายการ
            </span>
          ) : null}
          {aiProg.batches_total > 1 ? (
            <span className="nm">
              ชุด {aiProg.batches_done}/{aiProg.batches_total}
            </span>
          ) : null}
        </div>
        <div className="row" style={{ gap: 10 }}>
          {aiProg.total > 0 ? <span className="pc">{pct}%</span> : null}
          {aiBusy && aiProg.kind === 'run' ? (
            <button className="btn sm gh" onClick={stopAi} title="หยุดหลังชุดที่กำลังทำอยู่ (ผลที่ได้จะถูกบันทึก)">
              หยุด
            </button>
          ) : null}
        </div>
      </div>
      <div className="bar">
        <i style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <div className="row sp" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="nm" style={{ flex: '1 1 240px', minWidth: 0 }}>
          {hint}
        </span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {aiProg.phase === 'second_pass' && aiProg.focus_total ? (
            <span className="tg t-lil">
              เก็บตก {nf.format(aiProg.focus_done ?? 0)}/{nf.format(aiProg.focus_total)}
            </span>
          ) : null}
          {aiProg.failed > 0 ? <span className="tg t-bad">ไม่สำเร็จ {nf.format(aiProg.failed)}</span> : null}
          <span className="tg t-mut">⏱ {fmtDur(elapsed)}</span>
        </div>
      </div>
    </div>
  ) : null;

  const details = (
    <details className="m" style={{ fontSize: 12 }}>
      <summary style={{ cursor: 'pointer' }}>รายละเอียด</summary>
      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        <span>
          โมเดล: {ai?.provider ?? '—'}/{ai?.model ?? '—'}
          {ai?.thinking ? ' · โหมดคิด' : ''}
        </span>
        {lastAi?.enabled ? (
          <span>
            รอบล่าสุด: เรียก AI {nf.format(lastAi.called)} · ใช้ผลเดิม {nf.format(lastAi.cached)} · ไม่สำเร็จ{' '}
            {nf.format(lastAi.failed)} · {(lastAi.tokens?.prompt ?? 0) + (lastAi.tokens?.completion ?? 0)} tokens
            {lastAi.cost_usd ? ` · ~$${lastAi.cost_usd.toFixed(4)}` : ''}
          </span>
        ) : null}
        {lastAi ? (
          <span>
            การประหยัด: วลีจับได้ {nf.format(lastAi.phrase_hits ?? 0)} ค่า · ข้าม AI เพราะกฎครบแล้ว{' '}
            {nf.format(lastAi.gated ?? 0)} แถว
            {lastAi.focus_pass ? ` · เก็บเฉพาะทาง ${nf.format(lastAi.focus_pass)} แถว` : ''}
          </span>
        ) : null}
        <span>
          อ่านภาพ: {vision?.available ? `${vision.provider}/${vision.model} · detail ${vision.detail}` : 'ปิดอยู่'}
          {lastVision?.enabled
            ? ` · เรียกรูป ${nf.format(lastVision.called)} · cache ${nf.format(lastVision.cached)} · ได้ ${nf.format(lastVision.tags ?? 0)} ค่า`
            : ''}
        </span>
        {phraseValues > 0 || conflictPending > 0 ? (
          <span>
            ภาพรวมล่าสุด: ค่าจากพจนานุกรมวลี {nf.format(phraseValues)} ค่า
            {conflictPending > 0 ? ` · ขัดแย้งรอตรวจ ${nf.format(conflictPending)} ค่า` : ''}
          </span>
        ) : null}
        <span>ครั้งล่าสุด: {TH_DATETIME(auto?.last?.finished_at)}</span>
      </div>
    </details>
  );

  if (variant === 'lean') {
    return (
      <div className="card" style={{ gap: 8, padding: '14px 18px', borderRadius: 22 }}>
        <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>สถานะการประมวลผล</b>
            <span className={`tg ${status.cls}`}>{status.text}</span>
            {auto?.last?.finished_at ? <span className="m">{TH_DATETIME(auto.last.finished_at)}</span> : null}
            <span className="m">{aiSummary}</span>
            {vision?.available ? <span className="m">{visionSummary}</span> : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {actions}
            <Link href="/products?tab=pending" className="btn sm gh" style={{ textDecoration: 'none' }}>
              ไปหน้าตรวจ →
            </Link>
          </div>
        </div>
        {progress}
        {details}
      </div>
    );
  }

  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row sp" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>สถานะการประมวลผล</b>
          <span className={`tg ${status.cls}`}>{status.text}</span>
          {auto?.last?.finished_at ? <span className="m">{TH_DATETIME(auto.last.finished_at)}</span> : null}
          {auto?.last?.summary ? <span className="m">{nf.format(auto.last.summary.kept)} รายการ</span> : null}
          <span className="m">{aiSummary}</span>
          {vision?.available ? <span className="m">{visionSummary}</span> : null}
          {conflictPending > 0 ? <span className="tg t-amb">ขัดแย้งรอตรวจ {nf.format(conflictPending)}</span> : null}
        </div>
        <div className="row" style={{ gap: 8 }}>{actions}</div>
      </div>
      {progress}
      <div className="m" style={{ fontSize: 12 }}>
        หลังนำเข้าข้อมูล ระบบ normalize + ตีความ + AI + ตรวจคุณภาพ + เขียนกลับฐานข้อมูลให้อัตโนมัติ
        {auto?.enabled === false ? ' · ปิดอยู่ (AUTO_PIPELINE=0)' : ''}
      </div>
      {auto?.stale ? (
        <div className="m" style={{ color: 'var(--bad)' }}>
          สถานะค้างนานเกิน 10 นาที — กด “ประมวลผลใหม่”
        </div>
      ) : null}
      {auto?.last?.error ? <div className="m" style={{ color: 'var(--bad)' }}>{auto.last.error}</div> : null}
      {auto?.last?.sync?.hint ? <div className="m" style={{ color: 'var(--ambT)' }}>{auto.last.sync.hint}</div> : null}
      {details}
    </div>
  );
}
