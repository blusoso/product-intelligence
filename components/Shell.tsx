'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp, usePending } from '@/lib/store';
import { Ic } from './icons';
import { ModalRoot } from './ModalRoot';

// ✅ เพิ่ม 'shield' เข้าไปใน Type ของ Icon ที่อนุญาต
const NAV: Array<[string, 'grid' | 'box' | 'link' | 'refresh' | 'shield' | 'nodes' | 'spark', string]> = [
  ['overview', 'grid', 'Overview'],
  ['products', 'box', 'Products'],
  ['opportunities', 'spark', 'Opportunities'],
  ['relations', 'link', 'Relations'],
  ['ingestion', 'refresh', 'Ingestion'],
  ['data-quality', 'shield', 'Data Quality'],
  ['network', 'nodes', 'Network'],
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme, q, setQ, toast } = useApp();
  const p = usePending();
  const seg = pathname.split('/').filter(Boolean)[0] || 'overview';

  const onSearch = (v: string) => {
    setQ(v);
    if (!pathname.startsWith('/products')) router.push('/products');
  };

  return (
    <div id="app">
      <aside className="side">
        <div className="brand"><i><Ic n="bolt" s={20} c="#15182E" /></i>PI Admin</div>
        <div id="nav">
          {NAV.map(([k, icon, label]) => (
            <Link key={k} href={'/' + k} style={{ textDecoration: 'none' }}>
              <div className={'nv ' + (seg === k ? 'on' : '')}>
                <Ic n={icon} />
                {label}
                {k === 'relations' && p.relations > 0 && <b>{p.relations}</b>}
                {k === 'ingestion' && p.jobs > 0 && <b>{p.jobs}</b>}
              </div>
            </Link>
          ))}
          
          {/* เมนูที่ยังไม่เปิดใช้งาน */}
          {['Creators', 'Sellers', 'Feedback', 'Ranking', 'Audit log'].map(t => (
            <div key={t} className="nv off" title="เร็ว ๆ นี้"><Ic n="shield" />{t}</div>
          ))}
        </div>
        <div className="me">
          <div className="av">A</div>
          <div style={{ flex: 1, fontSize: 14 }}>
            <b>Admin</b>
            <div className="m" style={{ color: '#B8BDD0' }}>Owner</div>
          </div>
          <button onClick={toggleTheme} className="ib sq"
            style={{ background: '#15182E', color: '#B8BDD0' }} aria-label="ธีม">
            <Ic n={theme === 'dark' ? 'sun' : 'moon'} s={18} />
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="top">
          <label className="srch">
            <Ic n="search" s={18} />
            <input value={q} onChange={e => onSearch(e.target.value)} placeholder="ค้นหาสินค้า…" />
          </label>
          <span style={{ flex: 1 }} />
          <button className="ib" aria-label="แจ้งเตือน">
            <i />
            <Ic n="bell" />
          </button>
        </div>
        <div id="view" className="enter" key={pathname}>{children}</div>
      </div>

      <ModalRoot />
      {toast && <div className="toast"><Ic n="chk" s={16} c="#C8F560" />{toast}</div>}
    </div>
  );
}