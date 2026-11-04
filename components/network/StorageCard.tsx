'use client';

import { Ic } from '@/components/icons';
import { TH_DATETIME, nf, type SyncInfo } from './shared';

function Row({
  icon,
  title,
  detail,
  state,
  tone,
}: {
  icon: 'box' | 'nodes' | 'shield';
  title: string;
  detail: string;
  state: string;
  tone: string;
}) {
  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <Ic n={icon} s={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <div className="m" style={{ fontSize: 12 }}>
          {detail}
        </div>
      </div>
      <span className="tg" style={{ background: 'var(--bg)', color: tone, fontSize: 12 }}>
        {state}
      </span>
    </div>
  );
}

export function StorageCard({
  source,
  products,
  snapshotAt,
  snapshotPath,
  sync,
}: {
  source: 'db' | 'file';
  products: number;
  snapshotAt: string | null;
  snapshotPath: string | null;
  sync: SyncInfo | null;
}) {
  const syncState = !sync
    ? 'ยังไม่เปิด'
    : sync.skipped
      ? 'ข้าม'
      : `${nf.format(sync.updated)} แถว`;
  const syncTone = !sync ? 'var(--mute)' : sync.skipped ? 'var(--ambT)' : 'var(--ok)';

  return (
    <div className="card" style={{ gap: 12 }}>
      <h3 style={{ fontSize: 15 }}>
        <span>ข้อมูลถูกเก็บไว้ที่ไหน</span>
        <span className="m" style={{ fontWeight: 500, fontSize: 12 }}>
          ใช้ตอบคำถาม “กดแล้วข้อมูลหายไหม”
        </span>
      </h3>
      <Row
        icon="box"
        title={source === 'db' ? 'ตาราง products (Supabase)' : 'ไฟล์ data/products.json'}
        detail={
          source === 'db'
            ? 'ข้อมูลต้นฉบับที่ scraper ส่งเข้ามา — ไม่ถูกเขียนทับด้วยการสร้างกราฟ'
            : 'ไฟล์ในเครื่อง — ใช้ทดลองได้ แต่ไม่ใช่ข้อมูลจริง'
        }
        state={products > 0 ? `${nf.format(products)} แถว` : 'ยังไม่ตรวจ'}
        tone="var(--ink)"
      />
      <Row
        icon="nodes"
        title="Graph snapshot (ไฟล์)"
        detail={snapshotPath ? `data/network/graph.json · ${TH_DATETIME(snapshotAt)}` : 'ยังไม่ถูกสร้าง — กดขั้น 4'}
        state={snapshotPath ? 'มีแล้ว' : 'ยังไม่มี'}
        tone={snapshotPath ? 'var(--ok)' : 'var(--mute)'}
      />
      <Row
        icon="shield"
        title="คอลัมน์ normalized ใน DB"
        detail={
          sync?.hint
            ? sync.hint
            : 'brand · product_type · จังหวัด · quality_score (ต้อง apply migration ก่อน)'
        }
        state={syncState}
        tone={syncTone}
      />
    </div>
  );
}
