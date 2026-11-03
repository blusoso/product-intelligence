'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { TYPES } from '@/lib/data';

export function RelAdd() {
  const { products, relations, setRelations, pushActivity, showToast, setModal } = useApp();
  const [a, setA] = useState(products[0]?.id || 0);
  const [b, setB] = useState(products[1]?.id || products[0]?.id || 0);
  const [ty, setTy] = useState(TYPES[0]);
  const [err, setErr] = useState('');

  const save = () => {
    if (a === b) { setErr('เลือกสินค้าคนละชิ้น'); return; }
    if (relations.some(r => r.a === a && r.b === b)) { setErr('มีคู่นี้แล้ว'); return; }
    const id = Math.max(0, ...relations.map(r => r.id)) + 1;
    setRelations(rs => [{
      id, a, b, ty, c: 2, ev: 'เพิ่มโดยแอดมิน', src: 'Manual', st: 'อนุมัติ', w: .5,
      x: { 'โปรโมทคู่กัน (co-promotion)': '—', 'Audience overlap': '—', 'Creator overlap': '—', 'Co-save / co-click': '—' },
    }, ...rs]);
    const pa = products.find(x => x.id === a);
    const pb = products.find(x => x.id === b);
    if (pa && pb) pushActivity('Admin', `เพิ่มคู่ ${pa.name} → ${pb.name}`);
    showToast('เพิ่มคู่แล้ว');
    setModal({ kind: 'none' });
  };

  return (
    <>
      <b style={{ fontSize: 22 }}>เพิ่มคู่สินค้า</b>
      <div className="row" style={{ gap: 12 }}>
        <label className="f" style={{ flex: 1 }}>สินค้า A
          <select className="sel" value={a} onChange={e => setA(+e.target.value)}>
            {products.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="f" style={{ flex: 1 }}>สินค้า B
          <select className="sel" value={b} onChange={e => setB(+e.target.value)}>
            {products.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
      </div>
      <label className="f">ประเภท
        <select className="sel" value={ty} onChange={e => setTy(e.target.value)}>
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </label>
      {err && <div className="m" style={{ color: 'var(--bad)' }}>{err}</div>}
      <div className="row">
        <button className="btn gh" style={{ flex: 1 }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
        <button className="btn" style={{ flex: 1 }} onClick={save}>เพิ่มคู่</button>
      </div>
    </>
  );
}
