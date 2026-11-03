'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';
import { TAX } from '@/lib/data';
import type { Platform, ProductStatus } from '@/lib/types';

export function ProductForm({ id }: { id?: number }) {
  const { products, setProducts, pushActivity, showToast, setModal } = useApp();
  const existing = id ? products.find(x => x.id === id) : undefined;

  const [name, setName] = useState(existing?.name || '');
  const [sku, setSku] = useState(existing?.sku || '');
  const [plat, setPlat] = useState<string>(existing?.plat || 'tiktok');
  const [price, setPrice] = useState(String(existing?.price ?? ''));
  const [cm, setCm] = useState(String(existing?.cm ?? ''));
  const [cat, setCat] = useState(existing?.cat || TAX.cat[0]);
  const [st, setSt] = useState<string>(existing?.st || 'รอตรวจ');
  const [sty, setSty] = useState<string[]>(existing?.sty || []);
  const [au, setAu] = useState<string[]>(existing?.au || []);
  const [err, setErr] = useState('');

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const save = () => {
    const n = name.trim();
    const pr = Number(price);
    const cmv = Number(cm);
    const e = !n ? 'กรอกชื่อสินค้า' : !(pr > 0) ? 'ราคาต้องมากกว่า 0'
      : !(cmv >= 0 && cmv <= 100) ? 'ค่าคอมต้องอยู่ระหว่าง 0–100' : '';
    if (e) { setErr(e); return; }

    if (id) {
      setProducts(ps => ps.map(x => x.id === id ? {
        ...x, name: n, sku, plat: plat as Platform, price: pr, cm: cmv,
        cat, st: st as ProductStatus, sty, au, up: 'เมื่อกี้',
      } : x));
      pushActivity('Admin', 'แก้สินค้า ' + n);
    } else {
      setProducts(ps => {
        const newId = Math.max(...ps.map(x => x.id), 0) + 1;
        return [{
          id: newId, sku: sku || `SKU-${1000 + newId}`, ext: `${plat}:${1000 + newId}`,
          name: n, plat: plat as Platform, price: pr, cm: cmv, cat,
          t: 4, rel: 0, st: st as ProductStatus, up: 'เมื่อกี้',
          a: 'tote', g: newId % 4, sty, au,
        }, ...ps];
      });
      pushActivity('Admin', 'เพิ่มสินค้า ' + n);
    }
    showToast(id ? 'บันทึกแล้ว' : 'เพิ่มสินค้าแล้ว');
    setModal({ kind: 'none' });
  };

  return (
    <>
      <b style={{ fontSize: 22 }}>{id ? `แก้ไข ${existing?.name ?? ''}` : 'เพิ่มสินค้าใหม่'}</b>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="f" style={{ flex: 1 }}>ชื่อสินค้า
          <input className="in" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="f" style={{ width: 150 }}>SKU
          <input className="in" value={sku} onChange={e => setSku(e.target.value)} placeholder="อัตโนมัติ" />
        </label>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="f" style={{ flex: 1 }}>Platform
          <select className="sel" value={plat} onChange={e => setPlat(e.target.value)}>
            <option value="tiktok">TikTok Shop</option>
            <option value="shopee">Shopee</option>
          </select>
        </label>
        <label className="f" style={{ flex: 1 }}>ราคา (฿)
          <input className="in" type="number" value={price} onChange={e => setPrice(e.target.value)} />
        </label>
        <label className="f" style={{ flex: 1 }}>ค่าคอม (%)
          <input className="in" type="number" value={cm} onChange={e => setCm(e.target.value)} />
        </label>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="f" style={{ flex: 1 }}>หมวด
          <select className="sel" value={cat} onChange={e => setCat(e.target.value)}>
            {TAX.cat.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="f" style={{ flex: 1 }}>สถานะ
          <select className="sel" value={st} onChange={e => setSt(e.target.value)}>
            {['Active', 'รอตรวจ', 'ซ่อน'].map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="f">สไตล์ (ใช้จับคู่กับ creator)
        <div className="chs">
          {TAX.st.map(t => (
            <button key={t} type="button" className={'ch ' + (sty.includes(t) ? 'on' : '')}
              onClick={() => toggle(sty, t, setSty)}>{t}</button>
          ))}
        </div>
      </label>
      <label className="f">ออดิเอนซ์
        <div className="chs">
          {TAX.au.map(t => (
            <button key={t} type="button" className={'ch ' + (au.includes(t) ? 'on' : '')}
              onClick={() => toggle(au, t, setAu)}>{t}</button>
          ))}
        </div>
      </label>
      {err && <div className="m" style={{ color: 'var(--bad)' }}>{err}</div>}
      <div className="row">
        <button className="btn gh" style={{ flex: 1 }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
        <button className="btn" style={{ flex: 1 }} onClick={save}>{id ? 'บันทึกการเปลี่ยนแปลง' : 'เพิ่มสินค้า'}</button>
      </div>
    </>
  );
}
