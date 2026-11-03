'use client';
import { useMemo, useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { Ic, Tile, Plat, Dots, Tag } from '@/components/icons';
import type { Product } from '@/lib/types';

const CP = '24px minmax(180px,1.4fr) 100px 124px 62px 58px 80px 56px 84px 96px 124px';

export default function ProductsPage() {
  const {
    products, setProducts, sel, setSel, q, setQ, setModal,
    pushActivity, showToast, refreshFromServer,
  } = useApp();
  
  const [stFilter, setStFilter] = useState<'all' | 'Active' | 'ซ่อน' | 'รอตรวจ'>('all');
  const [platFilter, setPlatFilter] = useState<'all' | 'tiktok' | 'shopee'>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rawModal, setRawModal] = useState<any | null>(null);

  useEffect(() => {
    refreshFromServer().catch(() => {});
  }, []);

  const filtered = useMemo(() => products.filter(x => {
    if (stFilter !== 'all' && x.st !== stFilter) return false;
    if (platFilter !== 'all' && x.plat !== platFilter) return false;
    if (catFilter !== 'all' && x.cat !== catFilter) return false;
    if (q && !(x.name + x.sku).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [products, q, stFilter, platFilter, catFilter]);

  const counts = (s: string) => s === 'all' ? products.length : products.filter(x => x.st === s).length;
  const newCount = products.filter(x => x.st === 'รอตรวจ').length;

  const toggleSel = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSel(n);
  };
  const toggleAll = () => {
    if (sel.size === filtered.length) setSel(new Set());
    else setSel(new Set(filtered.map(x => x.id)));
  };

  const updateStatus = async (id: number, apiStatus: string, uiStatus: 'Active' | 'ซ่อน') => {
    setProducts(ps => ps.map(x => x.id === id ? { ...x, st: uiStatus, up: 'เมื่อกี้' } : x));
    try {
      const res = await fetch(`/api/products/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: apiStatus })
      });
      if (!res.ok) throw new Error();
      showToast(apiStatus === 'approved' ? '✅ อนุมัติแล้ว' : '❌ ปฏิเสธแล้ว');
      pushActivity('Admin', `${apiStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}สินค้า ID ${id}`);
    } catch {
      showToast('❌ อัปเดตไม่สำเร็จ');
      refreshFromServer(); 
    }
  };

  const bulkUpdateStatus = async (apiStatus: string, uiStatus: 'Active' | 'ซ่อน') => {
    if (sel.size === 0) return;
    setActionLoading(true);
    const ids = Array.from(sel);
    setProducts(ps => ps.map(x => sel.has(x.id) ? { ...x, st: uiStatus, up: 'เมื่อกี้' } : x));
    try {
      await Promise.all(ids.map(id => 
        fetch(`/api/products/${id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: apiStatus })
        })
      ));
      showToast(`✅ อัปเดต ${ids.length} รายการแล้ว`);
      pushActivity('Admin', `Bulk ${apiStatus === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'} ${ids.length} สินค้า`);
      setSel(new Set());
    } catch {
      showToast('❌ อัปเดตบางรายการไม่สำเร็จ');
      refreshFromServer();
    } finally {
      setActionLoading(false);
    }
  };

  const hideOne = (id: number) => {
    const item = products.find(x => x.id === id);
    if (!item) return;
    const isHidden = item.st === 'ซ่อน';
    updateStatus(id, isHidden ? 'approved' : 'archived', isHidden ? 'Active' : 'ซ่อน');
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshFromServer();
      showToast('โหลดแล้ว ' + r.count + ' รายการ');
    } catch {
      showToast('โหลดไม่ได้');
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Component: ตารางปกติ ───
  const TableRow = ({ x }: { x: Product }) => {
    const isHidden = x.st === 'ซ่อน';
    return (
      <div className={'tr ' + (sel.has(x.id) ? 's' : '')} style={{ '--c': CP } as React.CSSProperties}>
        <button className={'ck ' + (sel.has(x.id) ? 'on' : '')} onClick={() => toggleSel(x.id)}>
          <Ic n="chk" s={12} />
        </button>
        <div className="row">
          <Tile a={x.a} g={x.g} />
          <div>
            <b>{x.name}</b>
            <div className="m" style={{ fontSize: 12 }}>{x.sku}</div>
          </div>
        </div>
        <span className="row" style={{ gap: 8 }}>
          <Plat p={x.plat} />
          <span style={{ fontSize: 13 }}>{x.plat === 'tiktok' ? 'TikTok' : 'Shopee'}</span>
        </span>
        <Tag t={x.cat} />
        <b>฿{x.price}</b>
        <span>{x.cm}%</span>
        <Dots n={x.t} />
        <span className="row m" style={{ gap: 6 }}><Ic n="link" s={16} />{x.rel}</span>
        <Tag t={x.st} />
        <span className="m">{x.up}</span>
        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button className="ib sq" onClick={() => setModal({ kind: 'product', id: x.id })}><Ic n="pen" s={17} /></button>
          <button 
            className="ib sq" 
            onClick={() => hideOne(x.id)}
            title={isHidden ? 'แสดงสินค้า' : 'ซ่อนสินค้า'}
            style={{ color: isHidden ? 'var(--mute)' : 'var(--ok)' }}
          >
            <Ic n="eye" s={17} />
          </button>
          <button className="ib sq" style={{ color: 'var(--bad)' }} onClick={() => setModal({ kind: 'delete', id: x.id })}>
            <Ic n="trash" s={17} />
          </button>
        </span>
      </div>
    );
  };

  // ─── Component: Review Card (สำหรับแท็บ รอตรวจ) ───
  const ReviewCard = ({ x }: { x: Product }) => {
    // ดึงรูปภาพจาก JSON โดยเผื่อฟิลด์ไว้หลายแบบ
    const imgUrl = x.image || x._raw?.image || x._raw?.images?.[0] || '';
    const trustScore = Number(x.trust_score || x.t * 20);
    
    // Helper สำหรับสีของ Trust Score
    const trustColor = trustScore >= 70 ? 'var(--ok)' : trustScore >= 40 ? 'var(--warn)' : 'var(--bad)';

    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        
        {/* ส่วนบน: รูป + ชื่อ + ร้าน */}
        <div style={{ display: 'flex', gap: 14, padding: 16 }}>
          <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--line)' }}>
            {imgUrl ? (
              <img 
                src={imgUrl} 
                alt={x.name} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--mute)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg></div>'; }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mute)' }}>
                <Ic n="box" s={24} />
              </div>
            )}
          </div>
          
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 15, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.3 }}>
              {x.name}
            </b>
            <div className="m" style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              🏪 <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>{x.shop_name || 'ไม่ระบุร้าน'}</span>
              <a href={x.url} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Ic n="link" s={12} /> Shopee
              </a>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {x.shopee_verified && <span style={{ background: 'var(--blue)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>✓ Verified</span>}
              {x.is_ad && <span style={{ background: 'var(--mute)', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>📢 Ads</span>}
              <Tag t={x.cat} />
            </div>
          </div>
        </div>

        {/* ส่วนกลาง: ข้อมูลการตัดสินใจ (Grid 3 คอลัมน์) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'var(--line)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
          
          {/* คอลัมน์ 1: ราคา & คอมมิชชัน */}
          <div style={{ background: 'var(--card)', padding: '10px 12px' }}>
            <div className="m" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>ราคา / คอมมิชชัน</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>฿{x.price}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ok)' }}>+ ฿{x.commission_per_unit || x.cm} <span style={{fontSize: 10, fontWeight: 'normal', color: 'var(--mute)'}}>คอม</span></div>
          </div>

          {/* คอลัมน์ 2: ยอดขาย & Rating */}
          <div style={{ background: 'var(--card)', padding: '10px 12px' }}>
            <div className="m" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>ยอดขาย/เดือน</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{x.monthly_sold || 0} <span style={{fontSize: 11, fontWeight: 'normal', color: 'var(--mute)'}}>ชิ้น</span></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>⭐ {x.rating || '-'} <span style={{fontSize: 10, fontWeight: 'normal', color: 'var(--mute)'}}>({x.review_count || 0})</span></div>
          </div>

          {/* คอลัมน์ 3: Trust & อายุ */}
          <div style={{ background: 'var(--card)', padding: '10px 12px' }}>
            <div className="m" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>ความน่าเชื่อถือ</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2, color: trustColor }}>{trustScore}<span style={{fontSize: 11, fontWeight: 'normal', color: 'var(--mute)'}}>/100</span></div>
            <div style={{ fontSize: 11, color: 'var(--mute)' }}>{x.listing_age_days ? `อายุ ${x.listing_age_days} วัน` : 'ไม่ระบุอายุ'}</div>
          </div>

        </div>

        {/* ส่วนล่าง: ปุ่ม Action */}
        <div style={{ display: 'flex', gap: 8, padding: 12, background: 'var(--card)' }}>
          {/* ปุ่มดู Raw Data (เล็กสุด) */}
          <button className="btn sm gh" style={{ padding: '0 10px' }} onClick={() => setRawModal(x)} title="ดูข้อมูลดิบ (Raw Data)">
            <Ic n="file" s={16} />
          </button>
          
          {/* ปุ่มปฏิเสธ (Secondary/Danger) */}
          <button className="btn sm gh" style={{ flex: 1, color: 'var(--bad)', borderColor: 'var(--bad)' }} onClick={() => updateStatus(x.id, 'rejected', 'ซ่อน')}>
            <Ic n="trash" s={16} /> ปฏิเสธ
          </button>
          
          {/* ปุ่มอนุมัติ (Primary) */}
          <button className="btn sm" style={{ flex: 2, background: 'var(--ok)', color: '#fff', border: 'none' }} onClick={() => updateStatus(x.id, 'approved', 'Active')}>
            <Ic n="chk" s={16} /> อนุมัติ
          </button>
        </div>

      </div>
    );
  };

  return (
    <>
      {/* Modal ดู Raw Data */}
      {rawModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setRawModal(null)}>
          <div className="card" style={{ width: 'min(800px, 90vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="row sp" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Raw Data: {rawModal.name}</h3>
              <button className="ib sq" onClick={() => setRawModal(null)}>✕</button>
            </div>
            <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(rawModal._raw || rawModal, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <div className="hd">
        <div>
          <div className="s">Home / Products</div>
          <h1>Products</h1>
        </div>
        <div className="acts">
          <button className="btn gh" onClick={doRefresh} disabled={refreshing} style={{ opacity: refreshing ? .6 : 1 }}>
            <Ic n="refresh" s={17} />{refreshing ? 'กำลังโหลด…' : 'Refresh'}
          </button>
          <button className="btn gh" onClick={() => setModal({ kind: 'import' })}>
            <Ic n="upload" s={17} />นำเข้า JSON
          </button>
          <button className="btn" onClick={() => setModal({ kind: 'product' })}>+ เพิ่มสินค้า</button>
        </div>
      </div>

      {newCount > 0 && (
        <div className="warn">
          <Ic n="warn" s={20} />
          มีสินค้า <b>{newCount}</b> รายการรอตรวจ (จาก Ingestion / นำเข้า)
          <button className="btn sm" onClick={() => setStFilter('รอตรวจ')}>ดูเลย</button>
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="srch" style={{ width: 300, background: 'var(--card)', boxShadow: 'inset 0 0 0 1.5px var(--line)' }}>
          <Ic n="search" s={18} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อ / SKU" />
        </label>
        <select className="sel" value={platFilter} onChange={e => setPlatFilter(e.target.value as any)} style={{ width: 'auto', minWidth: 120, borderRadius: 22 }}>
          <option value="all">Platform</option>
          <option value="tiktok">TikTok</option>
          <option value="shopee">Shopee</option>
        </select>
        <select className="sel" value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ width: 'auto', minWidth: 140, borderRadius: 22 }}>
          <option value="all">หมวด</option>
          {['Home & Living', 'Gadget', 'Beauty', 'Fashion'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <div className="seg">
          {(['all', 'Active', 'ซ่อน', 'รอตรวจ'] as const).map(k => (
            <button key={k} className={stFilter === k ? 'on' : ''} onClick={() => setStFilter(k)}>
              {k === 'all' ? 'ทั้งหมด' : k} <span style={{ opacity: 0.7 }}>{counts(k)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action */}
      {sel.size > 0 && (
        <div className="bulk">
          <b>เลือก {sel.size} รายการ</b>
          <span className="m" style={{ color: '#B8BDD0' }}>ใช้กับรายการที่เลือกพร้อมกัน</span>
          <span style={{ flex: 1 }} />
          {stFilter === 'รอตรวจ' ? (
            <>
              <button className="btn sm dk" style={{ color: 'var(--ok)' }} onClick={() => bulkUpdateStatus('approved', 'Active')} disabled={actionLoading}>
                <Ic n="chk" s={16} /> อนุมัติทั้งหมด
              </button>
              <button className="btn sm dk" style={{ color: 'var(--bad)' }} onClick={() => bulkUpdateStatus('rejected', 'ซ่อน')} disabled={actionLoading}>
                <Ic n="trash" s={16} /> ปฏิเสธทั้งหมด
              </button>
            </>
          ) : (
            <>
              <button className="btn sm dk" style={{ color: 'var(--mute)' }} onClick={() => bulkUpdateStatus('archived', 'ซ่อน')}>
                <Ic n="eye" s={16} /> ซ่อน
              </button>
              <button className="btn sm dk" style={{ color: 'var(--ok)' }} onClick={() => bulkUpdateStatus('approved', 'Active')}>
                <Ic n="eye" s={16} /> แสดง
              </button>
              <button className="btn sm dk" style={{ color: '#FF9B7A' }} onClick={() => setModal({ kind: 'bulkDelete' })}>
                <Ic n="trash" s={16} /> ลบ
              </button>
            </>
          )}
        </div>
      )}

      {/* สลับมุมมอง */}
      {stFilter === 'รอตรวจ' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {filtered.map(x => <ReviewCard key={x.id} x={x} />)}
          {!filtered.length && (
            <div className="m" style={{ gridColumn: '1/-1', padding: 40, textAlign: 'center' }}>
              🎉 ไม่มีสินค้ารอตรวจแล้ว
            </div>
          )}
        </div>
      ) : (
        <div className="tbw">
          <div className="tbl">
            <div className="tr h" style={{ '--c': CP } as React.CSSProperties}>
              <button className={'ck ' + (sel.size && sel.size === filtered.length ? 'on' : '')} onClick={toggleAll}>
                <Ic n="chk" s={12} />
              </button>
              <span>สินค้า</span><span>Platform</span><span>หมวด</span><span>ราคา</span>
              <span>ค่าคอม</span><span>Trust</span><span>คู่</span><span>สถานะ</span>
              <span>แก้ไขล่าสุด</span><span></span>
            </div>
            {filtered.map(x => <TableRow key={x.id} x={x} />)}
            {!filtered.length && (
              <div className="m" style={{ padding: 40, textAlign: 'center' }}>
                ไม่มีสินค้าตรงกับตัวกรอง
              </div>
            )}
          </div>
        </div>
      )}

      <div className="m">แสดง {filtered.length} จาก {products.length} รายการ</div>
    </>
  );
}