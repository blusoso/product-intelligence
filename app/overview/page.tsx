'use client';
import { useRouter } from 'next/navigation';
import { useApp, usePending } from '@/lib/store';

const Kpi = ({ l, v, d, ok = true }: { l: string; v: string; d: string; ok?: boolean }) => (
  <div className="kpi">
    <div className="m b">{l}</div>
    <b>{v}</b>
    <div className="m b" style={{ color: ok ? 'var(--ok)' : 'var(--bad)' }}>{d}</div>
  </div>
);
const Bar = ({ l, p }: { l: string; p: number }) => (
  <div className="row" style={{ fontSize: 14 }}>
    <span style={{ width: 190, flex: 'none' }}>{l}</span>
    <div className="bar"><i style={{ width: Math.min(100, p * 2.8) + '%' }} /></div>
    <b style={{ width: 42, textAlign: 'right' }}>{p}%</b>
  </div>
);

export default function OverviewPage() {
  const router = useRouter();
  const { products, activity } = useApp();
  const p = usePending();

  const q = (n: number, t: string, a: string, act: () => void) => (
    <div className="row" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <b className="tg t-amb" style={{ minWidth: 34, height: 34, justifyContent: 'center', fontSize: 15 }}>{n}</b>
      <span style={{ flex: 1, fontWeight: 600 }}>{t}</span>
      <button className="btn sm gh" onClick={act}>{a}</button>
    </div>
  );

  return (
    <>
      <div className="hd"><div>
        <div className="s">สวัสดีตอนเช้า · งานที่ต้องจัดการมาก่อน ตัวเลขทีหลัง</div>
        <h1>Overview</h1>
      </div></div>

      <div className="g">
        <Kpi l="Creator ที่ยืนยันโปรไฟล์" v="1,284" d="▲ 12% จากสัปดาห์ก่อน" />
        <Kpi l="Feed ถูกเปิด" v="8.4k" d="▲ 6%" />
        <Kpi l="อัตรา Promote" v="14%" d="▲ 1.2 จุด" />
        <Kpi l="อัตรา Dismiss" v="22%" d="▼ 3 จุด (ดี)" />
      </div>

      <div className="g">
        <div className="card">
          <h3>ต้องจัดการวันนี้</h3>
          {q(p.relations, 'ความสัมพันธ์ที่รอตรวจ', 'ตรวจ', () => router.push('/relations'))}
          {q(p.products, 'สินค้ารอตรวจ (จาก Ingestion/นำเข้า)', 'ดู', () => router.push('/products'))}
          {q(products.filter(x => x.t < 4 && x.st !== 'ซ่อน').length, 'สินค้า Trust ต่ำกว่าเกณฑ์', 'ดู', () => router.push('/products'))}
          {q(p.jobs, 'Ingestion ล้มเหลว', 'Retry', () => router.push('/ingestion'))}
        </div>
        <div className="card">
          <h3>เหตุผลที่ Dismiss บ่อย</h3>
          <Bar l="ไม่สนใจสินค้าแนวนี้" p={34} />
          <Bar l="ค่าคอมต่ำเกินไป" p={22} />
          <Bar l="สินค้าซ้ำ/ทดแทนกัน" p={15} />
          <Bar l="คู่ที่แนะนำไม่เกี่ยวข้อง" p={12} />
          <Bar l="ไม่เชื่อถือสินค้า/ร้านค้า" p={9} />
        </div>
        <div className="card">
          <h3>กิจกรรมล่าสุด</h3>
          {activity.map((a, i) => (
            <div key={i} className="row" style={{ padding: '8px 0', fontSize: 14 }}>
              <div className="av" style={{ width: 32, height: 32, fontSize: 13, color: '#fff' }}>
                {a.who === 'ระบบ' ? 'S' : 'A'}
              </div>
              <span style={{ flex: 1 }}><b>{a.who}</b> {a.text}</span>
              <span className="m">{a.when}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
