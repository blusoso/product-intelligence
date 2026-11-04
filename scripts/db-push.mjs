#!/usr/bin/env node
/**
 * db-push.mjs — apply pending Supabase migrations without hand-writing DSNs
 * ------------------------------------------------------------------------
 * ทำไมต้องมีสคริปต์นี้:
 *  - `DATABASE_URL` ใน .env ที่ใช้อยู่ชี้ไปที่ db.<ref>.supabase.co ซึ่งเป็น IPv6-only
 *    และรหัสผ่านใน URL อาจเก่ากว่ารหัสจริง (มี DATABASE_PASSWORD แยกอยู่)
 *  - เครื่องนี้ต่อ IPv4 ได้ → ใช้ connection pooler (aws-0-<region>.pooler.supabase.com)
 *    โดยหาภูมิภาคที่ตรงกับโปรเจกต์ให้อัตโนมัติ
 *
 * ใช้งาน:
 *   npm run db:push              # apply migration ที่ยังไม่ถูก apply
 *   npm run db:push -- --dry     # ดูว่าจะ apply อะไร
 *   npm run db:push -- --list    # ดูสถานะ local vs remote
 *
 * ตั้งค่า (ใน .env):
 *   DATABASE_URL        — ใช้เอา host/ชื่อฐานข้อมูล/โปรเจกต์
 *   DATABASE_PASSWORD   — รหัสผ่านจริง (ถ้าไม่มีจะใช้จาก URL)
 *   SUPABASE_POOLER_REGION (ไม่บังคับ) — เช่น eu-west-1 เพื่อข้ามการค้นหา
 */
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const list = args.includes('--list');

/* ── อ่าน .env (ไม่พึ่ง dotenv เพื่อให้รันได้ทุกที่) ───────────── */
function loadEnv() {
  const out = {};
  let raw = '';
  try {
    raw = fs.readFileSync('.env', 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const dbUrl = env.DATABASE_URL;
if (!dbUrl) {
  console.error('ไม่พบ DATABASE_URL ใน .env');
  process.exit(1);
}

const parsed = new URL(dbUrl);
const projectRef = (parsed.hostname.split('.')[1] ?? '').trim();
const database = parsed.pathname.replace(/^\//, '') || 'postgres';
const password =
  env.DATABASE_PASSWORD || decodeURIComponent(parsed.password || '');
if (!password) {
  console.error('ไม่พบรหัสผ่านฐานข้อมูล (DATABASE_PASSWORD หรือ password ใน DATABASE_URL)');
  process.exit(1);
}

const REGIONS = [
  env.SUPABASE_POOLER_REGION,
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-south-1',
  'us-east-1',
  'us-west-1',
  'eu-central-1',
  'eu-west-1',
  'ca-central-1',
  'sa-east-1',
  'ap-northeast-2',
].filter(Boolean);

/** ต่อ TCP ดูว่าถึง host นี้ได้จริงไหม (เร็วกว่ารอ pg timeout) */
function reachable(host, port = 5432, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function dsn(host, user, port = 5432) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?sslmode=require`;
}

/* ── หา DSN ที่ใช้ได้: ตรง → pooler (ต้องทดสอบ auth จริง) ───── */
const directHost = parsed.hostname;
const candidates = [];
if (projectRef) {
  candidates.push({
    label: `direct (${directHost})`,
    url: dsn(directHost, parsed.username || 'postgres', Number(parsed.port) || 5432),
    host: directHost,
  });
  for (const region of REGIONS) {
    for (const prefix of ['aws-0', 'aws-1']) {
      const host = `${prefix}-${region}.pooler.supabase.com`;
      candidates.push({ label: `pooler ${region} (${prefix})`, url: dsn(host, `postgres.${projectRef}`), host });
    }
  }
}

/** ต่อได้จริงไหม: TCP ก่อน แล้วยืนยันด้วย CLI (pooler ตอบ "tenant not found" ถ้าผิดภูมิภาค) */
function probe(url) {
  const r = spawnSync('npx', ['--no-install', 'supabase', 'migration', 'list', '--db-url', url], {
    stdio: 'ignore',
    shell: true,
  });
  return r.status === 0;
}

let target = null;
for (const candidate of candidates) {
  if (!(await reachable(candidate.host))) continue;
  process.stdout.write(`ทดสอบ ${candidate.label} … `);
  if (probe(candidate.url)) {
    console.log('ok');
    target = candidate;
    break;
  }
  console.log('ใช้ไม่ได้');
}
if (!target) {
  console.error('ต่อฐานข้อมูลไม่ได้เลย (ทั้ง direct และ pooler) — ตรวจเครือข่าย/รหัสผ่าน');
  console.error('เคล็ดลับ: ตั้ง SUPABASE_POOLER_REGION ใน .env เช่น SUPABASE_POOLER_REGION=eu-west-1');
  process.exit(1);
}
console.log(`ใช้การเชื่อมต่อ: ${target.label}`);

const tail = ['--db-url', target.url];
const cliArgs = list
  ? ['--no-install', 'supabase', 'migration', 'list', ...tail]
  : ['--no-install', 'supabase', 'db', 'push', ...tail, '--include-all', '--yes', ...(dry ? ['--dry-run'] : [])];

const result = spawnSync('npx', cliArgs, { stdio: 'inherit', shell: true });
if (result.status !== 0) {
  console.error(`\nsupabase CLI ออกด้วยรหัส ${result.status}`);
  process.exit(result.status ?? 1);
}
if (!list && !dry) {
  console.log('\nถ้าแก้ schema เพิ่ม ให้ apply ก่อนรัน pipeline เสมอ (แอปจะ fallback ไปไฟล์ถ้าตารางยังไม่มี)');
}
