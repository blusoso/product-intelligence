'use client';
import { useApp } from '@/lib/store';
import { Ic } from '@/components/icons';

export function ConfirmDelete({ id }: { id: number }) {
  const { products, setProducts, relations, setRelations, pushActivity, showToast, setModal } = useApp();
  const x = products.find(p => p.id === id);
  if (!x) return null;
  const relCount = relations.filter(r => r.a === id || r.b === id).length;
  return (
    <>
      <div className="tile" style={{ width: 56, height: 56, borderRadius: 20, background: 'var(--badS)', color: 'var(--bad)' }}>
        <Ic n="warn" s={28} />
      </div>
      <b style={{ fontSize: 22 }}>ลบ &quot;{x.name}&quot; ?</b>
      <div style={{ fontSize: 14, color: 'var(--mute)', lineHeight: '22px' }}>
        สินค้านี้ถูกใช้อยู่: <b style={{ color: 'var(--ink)' }}>{relCount} ความสัมพันธ์</b> · <b style={{ color: 'var(--ink)' }}>{x.id * 3 + 3} ลิงก์โปรโมท</b><br />
        การลบถาวรทำให้ลิงก์เหล่านี้ใช้ไม่ได้ แนะนำให้ซ่อนแทน
      </div>
      <button className="btn" style={{ height: 48 }} onClick={() => {
        setProducts(ps => ps.map(p => p.id === id ? { ...p, st: 'ซ่อน' } : p));
        pushActivity('Admin', 'ซ่อน ' + x.name);
        showToast('ซ่อนแล้ว');
        setModal({ kind: 'none' });
      }}><Ic n="eye" s={17} />ซ่อนแทน (แนะนำ)</button>
      <button className="btn dg" style={{ height: 48 }} onClick={() => {
        setProducts(ps => ps.filter(p => p.id !== id));
        setRelations(rs => rs.filter(r => r.a !== id && r.b !== id));
        pushActivity('Admin', 'ลบ ' + x.name);
        showToast('ลบแล้ว · กู้คืนได้ใน 30 วัน');
        setModal({ kind: 'none' });
      }}><Ic n="trash" s={17} />ลบถาวร</button>
      <button className="btn gh" style={{ boxShadow: 'none', color: 'var(--mute)' }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
      <div className="m" style={{ fontSize: 12 }}>ทุกการลบถูกบันทึกใน Audit log และกู้คืนได้ภายใน 30 วัน</div>
    </>
  );
}

export function ConfirmBulkDelete() {
  const { setProducts, setRelations, sel, setSel, pushActivity, showToast, setModal } = useApp();
  const count = sel.size;
  return (
    <>
      <b style={{ fontSize: 22 }}>ลบ {count} สินค้า ?</b>
      <div className="m">แนะนำให้ซ่อนแทน เพราะลิงก์โปรโมทที่ใช้อยู่จะใช้ไม่ได้</div>
      <button className="btn" style={{ height: 48 }} onClick={() => {
        setProducts(ps => ps.map(p => sel.has(p.id) ? { ...p, st: 'ซ่อน' } : p));
        pushActivity('Admin', 'ซ่อน ' + count + ' สินค้า');
        showToast('ซ่อนแล้ว');
        setSel(new Set());
        setModal({ kind: 'none' });
      }}>ซ่อนแทน (แนะนำ)</button>
      <button className="btn dg" style={{ height: 48 }} onClick={() => {
        setProducts(ps => ps.filter(p => !sel.has(p.id)));
        setRelations(rs => rs.filter(r => !sel.has(r.a) && !sel.has(r.b)));
        pushActivity('Admin', 'ลบ ' + count + ' สินค้า');
        showToast('ลบแล้ว · กู้คืนได้ใน 30 วัน');
        setSel(new Set());
        setModal({ kind: 'none' });
      }}>ลบถาวร</button>
      <button className="btn gh" style={{ boxShadow: 'none' }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
    </>
  );
}
