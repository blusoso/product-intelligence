'use client';
import { useState, useEffect } from 'react';
import { useApp } from '@/lib/store';
import { TAX } from '@/lib/data';
import { norm, now } from '@/lib/utils';
import { Ic } from '@/components/icons';
import type { Product } from '@/lib/types';

const SAMPLE = JSON.stringify({
  source: 'demo@1.0',
  products: [
    { external_id: 'shopee:2193847', platform: 'shopee', name: 'Sunset Lamp XL', price: '590฿', commission_pct: 12, category: 'Home&Living', styles: ['Cozy'], audiences: ['Renter'] },
  ],
}, null, 2);

type Schema = 'scraper' | 'simple' | 'unknown';
interface Row {
  i: number; ext: string; plat: 'tiktok' | 'shopee'; name: string;
  price: number; cm: number; cat: string; sty: string[]; au: string[];
  t: number; isUpdate: boolean; w: string[]; er: string[]; raw: any;
}
interface Result {
  schema: Schema; fatal?: string; rows: Row[];
  meta?: { keyword?: string; count?: number; source?: string };
  ok: number; wn: number; bad: number; upd: number;
}

function detectSchema(j: any): Schema {
  if (Array.isArray(j)) return 'simple';
  if (j && j.items && Array.isArray(j.items)) return 'scraper';
  if (j && j.products && Array.isArray(j.products)) return 'simple';
  return 'unknown';
}
function guessCat(keyword: string): string {
  const k = String(keyword || '');
  if (/โต๊ะ|เก้าอี้|ชั้นวาง|โซฟา|เตียง|โคม|lamp|light/i.test(k)) return 'Home & Living';
  if (/หูฟัง|เคส|คอม|phone|gadget/i.test(k)) return 'Gadget';
  if (/ครีม|เซรั่ม|ลิป|serum|cream|lip/i.test(k)) return 'Beauty';
  if (/เสื้อ|กางเกง|กระเป๋า|tote|shirt|bag/i.test(k)) return 'Fashion';
  return 'Home & Living';
}
function commissionFor(price: number): number {
  if (price < 700) return 2;
  if (price < 1000) return 3;
  if (price < 1500) return 4;
  if (price < 2500) return 5;
  if (price < 4000) return 6;
  return 8;
}
function trustDots(t: number): number {
  return t >= 85 ? 5 : t >= 70 ? 4 : t >= 50 ? 3 : t >= 30 ? 2 : 1;
}

function validate(text: string, fix: boolean, existing: Product[]): Result {
  let j: any;
  try { j = JSON.parse(text); }
  catch (e: any) {
    return { schema: 'unknown', fatal: 'JSON ไม่ถูกต้อง: ' + e.message, rows: [], ok: 0, wn: 0, bad: 0, upd: 0 };
  }
  const schema = detectSchema(j);
  if (schema === 'unknown') {
    return { schema, fatal: 'ไม่รู้จัก schema — ต้องมี "items" หรือ "products"', rows: [], ok: 0, wn: 0, bad: 0, upd: 0 };
  }
  const arr: any[] = Array.isArray(j) ? j : schema === 'scraper' ? j.items : j.products;
  const meta = schema === 'scraper' ? { keyword: j.keyword, count: j.count, source: j.source } : undefined;
  const defCat = guessCat((meta && meta.keyword) || '');

  const rows: Row[] = arr.map((r, idx) => {
    const w: string[] = []; const er: string[] = [];
    let ext = ''; let plat: 'tiktok' | 'shopee' = 'shopee';
    let name = ''; let price = 0; let cm = 10; let cat = defCat;
    let sty: string[] = []; let au: string[] = []; let t = 4;

    if (schema === 'scraper') {
      if (!r.product_id) er.push('ไม่มี product_id');
      if (!r.name) er.push('ไม่มี name');
      ext = r.shop_id ? 'shopee:' + r.shop_id + ':' + r.product_id : 'shopee:' + r.product_id;
      name = r.name || '';
      const p = typeof r.price === 'number' ? r.price : parseFloat(String(r.price).replace(/[^0-9.]/g, ''));
      if (isNaN(p) || p <= 0) er.push('price ไม่ถูกต้อง');
      else price = p;
      cm = commissionFor(price);
      const ts = Number(r.trust_score);
      if (!isNaN(ts)) t = trustDots(ts);
    } else {
      if (!r.external_id) er.push('ไม่มี external_id');
      if (!r.name) er.push('ไม่มี name');
      ext = r.external_id || '';
      name = r.name || '';
      plat = r.platform || 'shopee';
      const p = typeof r.price === 'number' ? r.price : parseFloat(String(r.price).replace(/[^0-9.]/g, ''));
      if (isNaN(p) || p <= 0) er.push('price ไม่ถูกต้อง');
      else price = p;
      cm = Number(r.commission_pct != null ? r.commission_pct : 10);
      if (cm < 0 || cm > 100) { if (fix) { w.push('commission_pct → 10'); cm = 10; } else er.push('commission_pct ต้องอยู่ 0–100'); }
      cat = r.category || defCat;
      if (!TAX.cat.includes(cat)) {
        const m = TAX.cat.find(c => norm(c) === norm(cat));
        if (m && fix) { w.push('หมวด "' + cat + '" → "' + m + '"'); cat = m; }
        else er.push('ไม่พบหมวด "' + cat + '"');
      }
      sty = (r.styles || []).filter((s: string) => TAX.st.includes(s));
      au = (r.audiences || []).filter((s: string) => TAX.au.includes(s));
    }
    const isUpdate = existing.some(x => x.ext === ext);
    return { i: idx + 1, ext, plat, name, price, cm, cat, sty, au, t, isUpdate, w, er, raw: r };
  });

  return {
    schema, meta, rows,
    ok: rows.filter(r => !r.er.length && !r.w.length && !r.isUpdate).length,
    wn: rows.filter(r => !r.er.length && r.w.length).length,
    bad: rows.filter(r => r.er.length).length,
    upd: rows.filter(r => !r.er.length && r.isUpdate).length,
  };
}

export function ImportJSON() {
  const { products, setProducts, setJobs, pushActivity, showToast, setModal } = useApp();
  const [txt, setTxt] = useState(SAMPLE);
  const [fix, setFix] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [fileName, setFileName] = useState('');
  const [samples, setSamples] = useState<string[]>([]);
  const [loadingSample, setLoadingSample] = useState('');

  useEffect(() => {
    fetch('/data/manifest.json')
      .then(r => (r.ok ? r.json() : { files: [] }))
      .then(j => setSamples(Array.isArray(j.files) ? j.files : []))
      .catch(() => setSamples([]));
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    setTxt(text); setFileName(f.name);
    setResult(validate(text, fix, products));
  };
  const loadSample = async (name: string) => {
    setLoadingSample(name);
    try {
      const r = await fetch('/data/' + name);
      if (!r.ok) { showToast('โหลดไฟล์ไม่ได้: ' + name); return; }
      const text = await r.text();
      setTxt(text); setFileName(name);
      setResult(validate(text, fix, products));
    } catch { showToast('โหลดไฟล์ไม่ได้'); }
    finally { setLoadingSample(''); }
  };
  const dryRun = () => setResult(validate(txt, fix, products));

  // ★★★ FIX: คำนวณทุกอย่างล่วงหน้า BEFORE setProducts — updater pure เท่านั้น ★★★
  const doImport = () => {
    const r = result || validate(txt, fix, products);
    if (!r.rows) return;

    const valid = r.rows.filter(x => !x.er.length);
    const existingExts = new Set(products.map(p => p.ext));
    const toUpdate = valid.filter(x => existingExts.has(x.ext));
    const toAdd = valid.filter(x => !existingExts.has(x.ext));
    const addedCount = toAdd.length;
    const updatedCount = toUpdate.length;
    const skippedCount = r.bad;

    console.log('[ImportJSON] valid:', valid.length, '→ add:', addedCount, 'update:', updatedCount, 'skip:', skippedCount);

    // updater pure — StrictMode รัน 2 รอบ ผลเท่ากัน
    setProducts(ps => {
      const next = ps.map(p => ({ ...p }));
      let newId = Math.max(...next.map(p => p.id), 0) + 1;
      for (const row of toUpdate) {
        const idx = next.findIndex(p => p.ext === row.ext);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            name: row.name, plat: row.plat, price: row.price, cm: row.cm,
            cat: row.cat, sty: row.sty, au: row.au, t: row.t, up: 'เมื่อกี้',
          };
        }
      }
      for (const row of toAdd) {
        next.unshift({
          id: newId, sku: 'SKU-' + (1000 + newId), ext: row.ext,
          rel: 0, a: 'tote', g: newId % 4, st: 'รอตรวจ',
          name: row.name, plat: row.plat, price: row.price, cm: row.cm,
          cat: row.cat, sty: row.sty, au: row.au, t: row.t, up: 'เมื่อกี้',
        });
        newId++;
      }
      return next;
    });

    // side effect AFTER setState (คำนวณเสร็จแล้ว)
    pushActivity('Admin', 'นำเข้า JSON: เพิ่ม ' + addedCount + ' · อัปเดต ' + updatedCount);
    setJobs(js => [{ t: now(), s: 'Manual JSON', n: addedCount, u: updatedCount, f: skippedCount, st: 'สำเร็จ' }, ...js]);
    showToast('นำเข้าแล้ว · เพิ่ม ' + addedCount + ' · อัปเดต ' + updatedCount + ' · ข้าม ' + skippedCount);
    setResult(null);
    setModal({ kind: 'none' });
  };

  const problems = result && result.rows ? result.rows.filter(x => x.w.length || x.er.length) : [];
  const problemPreview = problems.slice(0, 15);
  const moreProblems = problems.length - problemPreview.length;
  const importable = result ? result.ok + result.wn + result.upd : 0;

  return (
    <>
      <div className="row sp">
        <b style={{ fontSize: 22 }}>นำเข้าด้วย JSON</b>
        <span className="m">scraper (items) หรือ simple (products) · Upsert ด้วย ext</span>
      </div>

      <label className="btn gh" style={{ cursor: 'pointer', justifyContent: 'center' }}>
        <Ic n="upload" s={16} />
        {fileName || 'เลือกไฟล์ .json จากเครื่อง'}
        <input type="file" hidden accept=".json,application/json,.txt" onChange={onFile} />
      </label>

      {samples.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="m" style={{ alignSelf: 'center' }}>ไฟล์ตัวอย่าง:</span>
          {samples.map(f => (
            <button key={f} className="btn sm gh" onClick={() => loadSample(f)}
              disabled={loadingSample === f} style={{ opacity: loadingSample === f ? 0.5 : 1 }}>
              <Ic n="file" s={14} />{loadingSample === f ? 'กำลังโหลด…' : f}
            </button>
          ))}
        </div>
      )}

      <div className="m">หรือวาง JSON ในช่องนี้</div>
      <textarea className="code" spellCheck={false} value={txt}
        onChange={e => { setTxt(e.target.value); setFileName(''); }} />

      <label className="row" style={{ fontSize: 14, fontWeight: 600, gap: 10 }}>
        <button className={'ck ' + (fix ? 'on' : '')} type="button" onClick={() => setFix(f => !f)}>
          <Ic n="chk" s={12} />
        </button>
        แก้ค่าที่แก้ได้อัตโนมัติ
      </label>

      {result && result.fatal && <div className="iss t-bad"><Ic n="warn" s={16} /> {result.fatal}</div>}

      {result && result.rows && result.rows.length > 0 && (
        <>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="tg t-ok" style={{ flex: 1, padding: '10px 14px', fontSize: 14, minWidth: 100 }}>ใหม่ {result.ok}</div>
            <div className="tg t-lil" style={{ flex: 1, padding: '10px 14px', fontSize: 14, minWidth: 100 }}>อัปเดต {result.upd}</div>
            <div className="tg t-amb" style={{ flex: 1, padding: '10px 14px', fontSize: 14, minWidth: 100 }}>เตือน {result.wn}</div>
            <div className="tg t-bad" style={{ flex: 1, padding: '10px 14px', fontSize: 14, minWidth: 100 }}>ข้าม {result.bad}</div>
          </div>
          {problemPreview.map(x => (
            <div key={x.i} className={'iss ' + (x.er.length ? 't-bad' : 't-amb')} style={{ marginTop: 8 }}>
              <b>#{x.i} {x.name || '(ไม่มีชื่อ)'} {x.er.length ? '· ผิดพลาด' : '· คำเตือน'}</b>
              {x.er.concat(x.w).map((t, k) => <span key={k}>• {t}</span>)}
            </div>
          ))}
          {moreProblems > 0 && <div className="m">และอีก {moreProblems} รายการ</div>}
        </>
      )}

      <div className="row">
        <button className="btn gh" style={{ flex: 1 }} onClick={() => setModal({ kind: 'none' })}>ยกเลิก</button>
        <button className="btn gh" style={{ flex: 1 }} onClick={dryRun}><Ic n="refresh" s={16} />ตรวจสอบ</button>
        <button className="btn" style={{ flex: 1, opacity: importable ? 1 : 0.5 }}
          disabled={!importable} onClick={doImport}>
          {result ? 'นำเข้า ' + importable + ' รายการ' : 'นำเข้า'}
        </button>
      </div>
    </>
  );
}
