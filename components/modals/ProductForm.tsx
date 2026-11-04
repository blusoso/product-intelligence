'use client';
import { useState } from 'react';
import { useApp } from '@/lib/store';

/**
 * ฟอร์มเพิ่ม/แก้สินค้าแบบเร็ว (ชื่อ/SKU/แพลตฟอร์ม/ราคา/ค่าคอม/สถานะ)
 * - เขียนลง DB จริงผ่าน /api/products (เดิมแก้แค่ state ฝั่ง client แล้วหาย)
 * - ฟิลด์อื่น (ประเภท/แบรนด์/จังหวัด/คำอธิบาย/attribute) แก้ที่หน้ารายละเอียดใน Products
 */
export function ProductForm({ id }: { id?: number }) {
  const { products, refreshFromServer, pushActivity, showToast, setModal } = useApp();
  const existing = id ? products.find(x => x.id === id) : undefined;

  const [name, setName] = useState(existing?.name || '');
  const [sku, setSku] = useState(existing?.sku || '');
  const [plat, setPlat] = useState<string>(existing?.plat || 'shopee');
  const [price, setPrice] = useState(String(existing?.price ?? ''));
  const [cm, setCm] = useState(String(existing?.commission_per_unit ?? existing?.cm ?? ''));
  const [st, setSt] = useState<string>(existing?.status || 'pending');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const n = name.trim();
    const pr = Number(price);
    const cmv = Number(cm || 0);
    const e = !n ? 'กรอกชื่อสินค้า' : !(pr > 0) ? 'ราคาต้องมากกว่า 0'
      : !(cmv >= 0) ? 'ค่าคอมต้องไม่ติดลบ' : '';
    if (e) { setErr(e); return; }
    setErr('');
    setSaving(true);
    try {
      const body = {
        name: n,
        sku: sku.trim() || undefined,
        plat,
        price: pr,
        commission_per_unit: cmv,
        status: st,
      };
      const res = await fetch(id ? `/api/products/${id}` : '/api/products', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'บันทึกไม่สำเร็จ');
      await refreshFromServer().catch(() => {});
      pushActivity('Admin', (id ? 'แก้สินค้า ' : 'เพิ่มสินค้า ') + n);
      showToast(id ? 'บันทึกแล้ว' : 'เพิ่มสินค้าแล้ว');
      setModal({ kind: 'none' });
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <b style={{ fontSize: 22 }}>{id ? `แก้ไข ${existing?.name ?? ''}` : 'เพิ่มสินค้าใหม่'}</b>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="f" style={{ flex: 1 }}>ชื่อสินค้า
          <input className="in" value={name} onChange={e => setName(e.target.value)} maxLength={300} />
        </label>
        <label className="f" style={{ width: 150 }}>SKU
          <input className="in" value={sku} onChange={e => setSku(e.target.value)} placeholder="อัตโนมัติ" maxLength={120} />
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
        <label className="f" style={{ flex: 1 }}>ค่าคอมต่อชิ้น (฿)
          <input className="in" type="number" value={cm} onChange={e => setCm(e.target.value)} />
        </label>
      </div>
      <label className="f">สถานะ
        <select className="sel" value={st} onChange={e => setSt(e.target.value)}>
          <option value="pending">รอตรวจ</option>
          <option value="approved">เผยแพร่</option>
          <option value="rejected">ตีกลับ</option>
          <option value="archived">ซ่อน</option>
        </select>
      </label>
      <div className="m" style={{ fontSize: 12 }}>
        ประเภทสินค้า/แบรนด์/จังหวัด/คำอธิบาย และ attribute 18 ช่อง แก้ได้ที่หน้ารายละเอียด (Products)
      </div>
      {err && <div className="m" style={{ color: 'var(--bad)' }}>{err}</div>}
      <div className="row">
        <button className="btn gh" style={{ flex: 1 }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={saving}>
          {saving ? 'กำลังบันทึก…' : id ? 'บันทึกการเปลี่ยนแปลง' : 'เพิ่มสินค้า'}
        </button>
      </div>
    </>
  );
}
