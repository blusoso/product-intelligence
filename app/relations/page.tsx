'use client';
import { useState } from 'react';
import { useApp, usePending } from '@/lib/store';
import { Ic, Tile, CDots, Tag } from '@/components/icons';
import { TYPES } from '@/lib/data';

const CR = '84px minmax(200px,1.6fr) 104px 100px 84px 44px';

export default function RelationsPage() {
  const { products, relations, setRelations, setModal, pushActivity, showToast } = useApp();
  const p = usePending();
  const [rt, setRt] = useState<string>('all');
  const [rp, setRp] = useState<boolean>(false);
  const [rs, setRs] = useState<number | null>(null);

  const filtered = relations.filter(r => (rt === 'all' || r.ty === rt) && (!rp || r.st === 'รอตรวจ'));
  const counts = (t: string) => t === 'all' ? relations.length : relations.filter(r => r.ty === t).length;
  const selected = filtered.find(r => r.id === rs) || filtered[0];

  const Pair = ({ a, b, z = 38 }: { a: number; b: number; z?: number }) => {
    const pa = products.find(x => x.id === a);
    const pb = products.find(x => x.id === b);
    if (!pa || !pb) return null;
    return (
      <div className="row" style={{ gap: 0 }}>
        <Tile a={pa.a} g={pa.g} z={z} />
        <div style={{ marginLeft: -10 }}><Tile a={pb.a} g={pb.g} z={z} /></div>
      </div>
    );
  };

  const approve = (id: number) => {
    setRelations(list => list.map(r => r.id === id ? { ...r, st: 'อนุมัติ' as const } : r));
    const r = relations.find(x => x.id === id);
    if (r) {
      const pa = products.find(x => x.id === r.a);
      const pb = products.find(x => x.id === r.b);
      if (pa && pb) pushActivity('Admin', `อนุมัติคู่ ${pa.name} → ${pb.name}`);
    }
    showToast('อนุมัติแล้ว');
  };

  return (
    <>
      <div className="hd">
        <div>
          <div className="s">Home / Relations · ระบบแนะนำคู่ให้ แอดมินตรวจก่อนโชว์</div>
          <h1>Product relations</h1>
        </div>
        <div className="acts">
          <button className="btn" onClick={() => setModal({ kind: 'relAdd' })}>+ เพิ่มคู่เอง</button>
        </div>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {['all', ...TYPES].map(t => {
          const on = rt === t;
          return (
            <button key={t} className={'btn sm ' + (on ? '' : 'gh')}
              style={on ? { background: 'var(--ink)', color: 'var(--bg)' } : {}}
              onClick={() => setRt(t)}>
              {t === 'all' ? 'ทั้งหมด' : t} <span style={{ opacity: .7 }}>{counts(t)}</span>
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button className="tg t-amb"
          style={{ height: 36, padding: '0 14px', fontSize: 14, ...(rp ? { outline: '2px solid var(--ambT)' } : {}) }}
          onClick={() => setRp(v => !v)}>
          รอตรวจ {p.relations}
        </button>
      </div>

      <div className="g" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div className="tbw" style={{ flex: 1, minWidth: 0 }}>
          <div className="tbl" style={{ minWidth: 640 }}>
            <div className="tr h" style={{ '--c': CR } as React.CSSProperties}>
              <span>คู่</span><span>รายละเอียด</span><span>ประเภท</span>
              <span>ความมั่นใจ</span><span>สถานะ</span><span></span>
            </div>
            {filtered.length ? filtered.map(r => {
              const pa = products.find(x => x.id === r.a);
              const pb = products.find(x => x.id === r.b);
              if (!pa || !pb) return null;
              return (
                <div key={r.id}
                  className={'tr cl ' + (r.id === selected?.id ? 's' : '')}
                  style={{ '--c': CR } as React.CSSProperties}
                  onClick={() => setRs(r.id)}>
                  <Pair a={r.a} b={r.b} />
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 14 }}>{pa.name} {r.ty === 'ทดแทนกัน' ? '↔' : '→'} {pb.name}</b>
                    <div className="m" style={{ fontSize: 12 }}>{r.ev} · {r.src}</div>
                  </div>
                  <Tag t={r.ty} />
                  <span className="row" style={{ gap: 6 }}>
                    <CDots n={r.c} /><span className="m">{['', 'ต่ำ', 'กลาง', 'สูง'][r.c]}</span>
                  </span>
                  <Tag t={r.st} />
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {r.st === 'รอตรวจ' && (
                      <button className="ib sq" style={{ background: 'var(--lime)', color: '#15182E' }}
                        onClick={e => { e.stopPropagation(); approve(r.id); }}>
                        <Ic n="chk" s={16} />
                      </button>
                    )}
                  </span>
                </div>
              );
            }) : (
              <div className="m" style={{ padding: 40, textAlign: 'center' }}>ไม่มีรายการ</div>
            )}
          </div>
        </div>

        <div className="card" style={{ width: 410, flex: 'none' }}>
          {!selected ? (
            <div className="m">เลือกคู่จากรายการ</div>
          ) : (() => {
            const pa = products.find(x => x.id === selected.a);
            const pb = products.find(x => x.id === selected.b);
            if (!pa || !pb) return <div className="m">ไม่พบสินค้า</div>;
            return (
              <>
                <h3>รายละเอียดคู่ที่เลือก</h3>
                <div className="row">
                  <Pair a={selected.a} b={selected.b} z={56} />
                  <div>
                    <b style={{ fontSize: 17 }}>{pa.name} {selected.ty === 'ทดแทนกัน' ? '↔' : '→'} {pb.name}</b>
                    <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                      <Tag t={selected.st} /><Tag t={selected.src} />
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <label className="f" style={{ flex: 1 }}>ประเภท
                    <select className="sel" value={selected.ty}
                      onChange={e => {
                        const v = e.target.value;
                        setRelations(list => list.map(r => r.id === selected.id ? { ...r, ty: v } : r));
                        showToast('เปลี่ยนประเภทแล้ว');
                      }}>
                      {TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="f" style={{ flex: 1 }}>น้ำหนัก (0–1)
                    <input key={selected.id} className="in" defaultValue={selected.w}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (v >= 0 && v <= 1) {
                          setRelations(list => list.map(r => r.id === selected.id ? { ...r, w: v } : r));
                        }
                      }} />
                  </label>
                </div>
                <div>
                  <div className="m b">Evidence</div>
                  {Object.entries(selected.x).map(([k, v]) => (
                    <div key={k} className="row sp" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
                      <span className="m">{k}</span><b>{v}</b>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="m b" style={{ marginBottom: 6 }}>พรีวิวที่ผู้ใช้เห็น (ไม่โชว์คะแนน)</div>
                  <div className="row" style={{ background: 'var(--bg)', borderRadius: 18, padding: 12 }}>
                    <Tile a={pb.a} g={pb.g} z={52} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <b>{pb.name}</b><Tag t={selected.ty} />
                      </div>
                      <div className="m">{selected.ev}</div>
                    </div>
                  </div>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn" onClick={() => approve(selected.id)}><Ic n="chk" s={16} />อนุมัติ</button>
                  <button className="btn gh" onClick={() => {
                    setRelations(list => list.map(r => r.id === selected.id ? { ...r, st: r.st === 'ซ่อน' ? 'อนุมัติ' : 'ซ่อน' } : r));
                    showToast(selected.st === 'ซ่อน' ? 'แสดงแล้ว' : 'ซ่อนจากผู้ใช้แล้ว');
                  }}>
                    <Ic n="eye" s={16} />{selected.st === 'ซ่อน' ? 'แสดง' : 'ซ่อนจากผู้ใช้'}
                  </button>
                  <button className="btn dg" onClick={() => {
                    setRelations(list => list.filter(r => r.id !== selected.id));
                    showToast('ลบแล้ว');
                  }}>
                    <Ic n="trash" s={16} />ลบ
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
