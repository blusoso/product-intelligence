'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ic } from '@/components/icons';
import { useApp } from '@/lib/store';
import { nf } from '@/components/network/shared';
import { PipelineCard } from '@/components/products/PipelineCard';
import { ProductPanel, type ReviewOptions } from '@/components/products/ProductPanel';

type Tab = 'pending' | 'approved' | 'rejected' | 'archived' | 'all';

interface Row {
  id: number;
  name: string;
  sku: string;
  ext: string;
  plat: string;
  image: string | null;
  price: number;
  shop_name: string;
  status: string;
  st: string;
  product_type: string;
  quality_score: number | null;
  has_overrides?: boolean;
  badges?: {
    attributes_filled: number;
    ai_values: number;
    verified_values: number;
    overridden: number;
    missing_fields: string[];
  };
}

interface Counts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
  archived: number;
}

const TABS: Array<[Tab, string]> = [
  ['pending', 'รอตรวจ'],
  ['approved', 'เผยแพร่'],
  ['rejected', 'ตีกลับ'],
  ['archived', 'ซ่อน'],
  ['all', 'ทั้งหมด'],
];

const EMPTY_COUNTS: Counts = { all: 0, pending: 0, approved: 0, rejected: 0, archived: 0 };

export default function ProductsPage() {
  const { showToast, setModal, q: globalQ, refreshFromServer } = useApp();

  const [tab, setTab] = useState<Tab>('pending');
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(globalQ ?? '');
  const [plat, setPlat] = useState<'all' | 'shopee' | 'tiktok'>('all');
  const [options, setOptions] = useState<ReviewOptions | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // ค้นหาจากช่องค้นหาด้านบน (Shell) → ส่งต่อเข้าหน้านี้
  useEffect(() => {
    setQ(globalQ ?? '');
  }, [globalQ]);

  // อ่านแท็บจาก URL (?tab=pending) เพื่อให้ลิงก์จากหน้า Network ใช้ได้
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.some(([k]) => k === t)) setTab(t);
  }, []);

  useEffect(() => {
    fetch('/api/products/options', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setOptions(j as ReviewOptions);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab, limit: '200' });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/products?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'โหลดรายการไม่ได้');
      setRows(json.products as Row[]);
      setCounts(json.counts ?? EMPTY_COUNTS);
      setTotal(json.total ?? json.count ?? 0);
      setActiveId((prev) => {
        const list = json.products as Row[];
        if (prev && list.some((r) => r.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      showToast(`โหลดรายการไม่ได้: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [q, showToast, tab]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const filtered = useMemo(
    () => rows.filter((r) => (plat === 'all' ? true : r.plat === plat)),
    [rows, plat],
  );

  const activeIndex = filtered.findIndex((r) => r.id === activeId);

  const move = useCallback(
    (dir: -1 | 1) => {
      if (!filtered.length) return;
      const next = Math.min(Math.max(activeIndex + dir, 0), filtered.length - 1);
      const row = filtered[next];
      if (!row) return;
      setActiveId(row.id);
      const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    },
    [activeIndex, filtered],
  );

  const changeStatus = useCallback(
    async (id: number, status: 'approved' | 'rejected' | 'pending' | 'archived') => {
      // เลื่อนไปแถวถัดไปก่อน แล้วค่อยโหลดใหม่ (แถวที่อนุมัติจะหลุดจากคิว)
      move(1);
      try {
        const res = await fetch(`/api/products/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'อัปเดตสถานะไม่สำเร็จ');
        const label = status === 'approved' ? 'อนุมัติแล้ว' : status === 'rejected' ? 'ตีกลับแล้ว' : 'อัปเดตสถานะแล้ว';
        showToast(`${label} · เหลือรอตรวจ ${Math.max(0, counts.pending - (status === 'approved' ? 1 : 0))}`);
        await load();
        refreshFromServer().catch(() => {});
      } catch (e) {
        showToast(`อัปเดตสถานะไม่สำเร็จ: ${(e as Error).message}`);
        await load();
      }
    },
    [counts.pending, load, move, refreshFromServer, showToast],
  );

  const bulkStatus = useCallback(
    async (status: 'approved' | 'rejected' | 'archived') => {
      if (!sel.size) return;
      const ids = [...sel];
      const verb = status === 'approved' ? 'อนุมัติ' : status === 'rejected' ? 'ตีกลับ' : 'ซ่อน';
      if (!confirm(`${verb} ${ids.length} รายการที่เลือก?`)) return;
      setBulkBusy(true);
      try {
        const res = await fetch('/api/products/bulk-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, status }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'อัปเดตไม่สำเร็จ');
        showToast(`${verb}แล้ว ${json.updated} รายการ`);
        setSel(new Set());
        await load();
        refreshFromServer().catch(() => {});
      } catch (e) {
        showToast(`อัปเดตไม่สำเร็จ: ${(e as Error).message}`);
      } finally {
        setBulkBusy(false);
      }
    },
    [load, refreshFromServer, sel, showToast],
  );

  const toggleSel = (id: number) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteRow = useCallback(
    async (id: number) => {
      if (!confirm('ลบสินค้ารายการนี้ถาวร? (ข้อมูลดิบใน raw_products ยังอยู่)')) return;
      try {
        move(1);
        const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? 'ลบไม่สำเร็จ');
        showToast('ลบแล้ว');
        await load();
        refreshFromServer().catch(() => {});
      } catch (e) {
        showToast(`ลบไม่สำเร็จ: ${(e as Error).message}`);
        await load();
      }
    },
    [load, move, refreshFromServer, showToast],
  );

  // คีย์ลัด: j/k เลื่อน, a อนุมัติ, r ตีกลับ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'a' && activeId) {
        e.preventDefault();
        changeStatus(activeId, 'approved');
      } else if (e.key === 'r' && activeId) {
        e.preventDefault();
        changeStatus(activeId, 'rejected');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, changeStatus, move]);

  const selectedAll = filtered.length > 0 && filtered.every((r) => sel.has(r.id));

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">Home / Products</div>
          <h1>Products</h1>
          <div className="m" style={{ marginTop: 4 }}>
            ตรวจข้อมูลให้ครบ → แก้ถ้าผิด → อนุมัติ · คีย์ลัด j/k เลื่อน, a อนุมัติ, r ตีกลับ
          </div>
        </div>
        <div className="acts">
          <button className="btn gh" onClick={load} disabled={loading}>
            <Ic n="refresh" s={17} /> {loading ? 'กำลังโหลด…' : 'Refresh'}
          </button>
          <button className="btn gh" onClick={() => setModal({ kind: 'import' })}>
            <Ic n="upload" s={17} /> นำเข้า JSON
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'product' })}>
            + เพิ่มสินค้า
          </button>
        </div>
      </div>

      <PipelineCard onUpdated={load} />

      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <label className="srch" style={{ width: 300, background: 'var(--card)', boxShadow: 'inset 0 0 0 1.5px var(--line)' }}>
          <Ic n="search" s={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / SKU / ร้าน" />
        </label>
        <select className="sel" value={plat} onChange={(e) => setPlat(e.target.value as any)} style={{ width: 'auto', minWidth: 120, borderRadius: 22 }}>
          <option value="all">ทุกแพลตฟอร์ม</option>
          <option value="shopee">Shopee</option>
          <option value="tiktok">TikTok</option>
        </select>
        <span style={{ flex: 1 }} />
        <div className="seg">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              className={tab === k ? 'on' : ''}
              onClick={() => {
                setTab(k);
                setSel(new Set());
              }}
            >
              {label} <span style={{ opacity: 0.7 }}>{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {sel.size > 0 ? (
        <div className="bulk">
          <b>เลือก {sel.size} รายการ</b>
          <span className="m" style={{ color: '#B8BDD0' }}>
            ใช้กับรายการที่เลือกพร้อมกัน
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn sm dk" style={{ color: 'var(--ok)' }} onClick={() => bulkStatus('approved')} disabled={bulkBusy}>
            <Ic n="chk" s={16} /> อนุมัติ
          </button>
          <button className="btn sm dk" style={{ color: 'var(--bad)' }} onClick={() => bulkStatus('rejected')} disabled={bulkBusy}>
            <Ic n="trash" s={16} /> ตีกลับ
          </button>
          <button className="btn sm dk" style={{ color: 'var(--mute)' }} onClick={() => bulkStatus('archived')} disabled={bulkBusy}>
            <Ic n="eye" s={16} /> ซ่อน
          </button>
        </div>
      ) : null}

      <div className="g" style={{ alignItems: 'flex-start' }}>
        {/* ── คิว ── */}
        <div className="card" style={{ flex: '0 0 372px', padding: 10, gap: 6 }}>
          <div className="row sp" style={{ padding: '4px 8px' }}>
            <b style={{ fontSize: 14 }}>{TABS.find(([k]) => k === tab)?.[1]}</b>
            <span className="m" style={{ fontSize: 12 }}>
              {filtered.length} / {total} รายการ
            </span>
          </div>
          <div ref={listRef} style={{ maxHeight: 'calc(100vh - 320px)', overflow: 'auto', display: 'grid', gap: 6 }}>
            {loading && !rows.length ? <div className="m" style={{ padding: 16 }}>กำลังโหลด…</div> : null}
            {!loading && !filtered.length ? (
              <div className="m" style={{ padding: 24, textAlign: 'center' }}>
                🎉 ไม่มีรายการในหมวดนี้
              </div>
            ) : null}
            {filtered.map((r) => {
              const on = activeId === r.id;
              const badges = r.badges;
              return (
                <div
                  key={r.id}
                  data-row={r.id}
                  onClick={() => setActiveId(r.id)}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderRadius: 16,
                    cursor: 'pointer',
                    background: on ? 'var(--limeS)' : 'transparent',
                    boxShadow: on ? 'inset 0 0 0 1.5px var(--lime)' : 'none',
                  }}
                >
                  <button
                    className={'ck ' + (sel.has(r.id) ? 'on' : '')}
                    style={{ marginTop: 4, flex: 'none' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSel(r.id);
                    }}
                    aria-label="เลือก"
                  >
                    <Ic n="chk" s={12} />
                  </button>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      flex: 'none',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: 'var(--bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {r.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Ic n="box" s={18} />
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        lineHeight: 1.3,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {r.name}
                    </div>
                    <div className="m" style={{ fontSize: 11, marginTop: 2 }}>
                      {r.shop_name} · ฿{nf.format(Math.round(Number(r.price ?? 0)))}
                    </div>
                    <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {badges ? (
                        <>
                          <span className="tg t-mut" style={{ fontSize: 10, padding: '1px 6px' }}>
                            attr {badges.attributes_filled}/18
                          </span>
                          {badges.ai_values ? (
                            <span className="tg t-mut" style={{ fontSize: 10, padding: '1px 6px' }}>
                              AI {badges.ai_values}
                            </span>
                          ) : null}
                          {badges.overridden ? (
                            <span className="tg t-lil" style={{ fontSize: 10, padding: '1px 6px' }}>
                              คนแก้ {badges.overridden}
                            </span>
                          ) : null}
                          {badges.missing_fields.length ? (
                            <span className="tg t-amb" style={{ fontSize: 10, padding: '1px 6px' }}>
                              ขาด {badges.missing_fields.length}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ padding: '4px 8px', gap: 8 }}>
            <button
              className={'ck ' + (selectedAll ? 'on' : '')}
              onClick={() => setSel(selectedAll ? new Set() : new Set(filtered.map((r) => r.id)))}
              aria-label="เลือกทั้งหมด"
            >
              <Ic n="chk" s={12} />
            </button>
            <span className="m" style={{ fontSize: 12 }}>
              เลือกทั้งหมดในหน้านี้
            </span>
          </div>
        </div>

        {/* ── รายละเอียด ── */}
        <div style={{ flex: '1 1 620px', minWidth: 0 }}>
          {activeId ? (
            <ProductPanel
              id={activeId}
              options={options}
              onChanged={load}
              onStatus={(s) => changeStatus(activeId, s)}
              onDelete={() => deleteRow(activeId)}
              onPrev={() => move(-1)}
              onNext={() => move(1)}
            />
          ) : (
            <div className="card">
              <div className="m">เลือกรายการจากคิวทางซ้ายเพื่อตรวจ</div>
            </div>
          )}
        </div>
      </div>

      <div className="m">
        แสดง {filtered.length} จาก {total} รายการ · รอตรวจทั้งหมด {counts.pending} รายการ
      </div>
    </>
  );
}
