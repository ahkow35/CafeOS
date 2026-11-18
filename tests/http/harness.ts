/**
 * Harness for the HTTP characterization tests (tests/http/workflows.test.ts).
 *
 * One throwaway database, one `next dev` server, real HTTP calls. Nothing here
 * runs at import time, so with no TEST_DATABASE_URL the suite just skips.
 *
 * Safety: refuses any database that is not on this machine, makes its OWN
 * database (never the one tests/db uses), starts the server with an explicit
 * environment that sets every variable the app reads, so no value from a .env
 * file is used and nothing outside the machine is reachable.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

export const adminUrl = process.env.TEST_DATABASE_URL;
export const skip: string | false = adminUrl ? false : 'TEST_DATABASE_URL not set';

export const PIN = '246810'; // fake, only ever valid inside the throwaway database
const REPO = path.resolve(__dirname, '..', '..');

export type Role = 'owner' | 'manager' | 'staff' | 'part_timer';
export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A person the tests can act as. Signs in lazily through POST /api/auth/login. */
export interface Person {
  id: string;
  phone: string;
  cafeId: string | null;
  cookie(): Promise<string>;
}

export interface Env {
  base: string;
  pool: Pool;
  cafe1: string;
  cafe2: string;
  pendingCafe: string;
  people: Record<'owner' | 'manager' | 'staff' | 'partTimer' | 'owner2' | 'inactive' | 'super' | 'multi', Person>;
}

/** Filled in by startHarness(); case modules read it inside tests only. */
export const env = {} as Env;

let dbName = '';
let runUrlValue = '';
let admin: Pool | null = null;
let server: ChildProcess | null = null;
let serverLog = '';
let phoneSeq = 0;
let serverSecret = '';

// ─── safety ──────────────────────────────────────────────────────────────────

export function assertLocalDatabaseUrl(raw: string): void {
  const u = new URL(raw);
  const host = decodeURIComponent(u.hostname).replace(/^\[|\]$/g, '');
  const socket = u.searchParams.get('host') ?? '';
  const ok = ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/') || (host === '' && socket.startsWith('/'));
  if (!ok) throw new Error(`Refusing to run: TEST_DATABASE_URL host "${host || socket}" is not local`);
}

function urlForDb(raw: string, name: string): string {
  const u = new URL(raw);
  u.pathname = `/${name}`;
  return u.toString();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

// ─── start / stop ────────────────────────────────────────────────────────────

export async function startHarness(): Promise<void> {
  if (!adminUrl) throw new Error('TEST_DATABASE_URL not set');
  assertLocalDatabaseUrl(adminUrl);
  try {
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    dbName = `cafeos_http_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE ${dbName}`);
    const runUrl = urlForDb(adminUrl, dbName);
    runUrlValue = runUrl;
    env.pool = new Pool({ connectionString: runUrl, max: 4 });
    await env.pool.query(readFileSync(path.join(REPO, 'db', 'schema.sql'), 'utf8'));
    await seedFixtures();
    await startServer(runUrl);
  } catch (e) {
    await stopHarness();
    throw e;
  }
}

export async function stopHarness(): Promise<void> {
  const child = server;
  server = null;
  if (child && child.pid && child.exitCode === null) {
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, 8000);
    await exited;
    clearTimeout(timer);
  }
  if (env.pool) { await env.pool.end().catch(() => {}); }
  if (admin && dbName) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); }
  if (admin) { await admin.end().catch(() => {}); admin = null; }
}

async function startServer(runUrl: string): Promise<void> {
  const port = await freePort();
  serverSecret = randomBytes(48).toString('base64'); // per run, never written down
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    LOCAL_PG_URL: runUrl,
    JWT_SECRET: serverSecret,
    TELEGRAM_BOT_TOKEN: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    BLOB_READ_WRITE_TOKEN: '',
    POSTGRES_URL: '',
    // `next dev` still loads .env* files from the repo folder, but never over a
    // variable that is already set. So every variable the app reads is set here,
    // and a developer's .env.local cannot reach this server.
    APP_BASE_URL: '',
    STRIPE_PRICE_ID: '',
    TELEGRAM_WEBHOOK_SECRET: '',
  };
  const bin = path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [bin, 'dev', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: REPO, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  const grab = (b: Buffer) => { serverLog += b.toString(); if (serverLog.length > 60000) serverLog = serverLog.slice(-40000); };
  child.stdout?.on('data', grab);
  child.stderr?.on('data', grab);
  process.once('exit', () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } });

  env.base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next dev exited early (${child.exitCode}). Output:\n${serverLog}`);
    try {
      const r = await fetch(`${env.base}/api/ping`);
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`next dev did not answer within 90s. Output:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** URL of this run's throwaway database, for cases that run library code against it (in a child process, so its connections end with it). */
export function runDatabaseUrl(): string { return runUrlValue; }

/** This run's JWT_SECRET, for cases that must write a value the server derives from it (a PIN reset code hash). Memory only. */
export function serverJwtSecret(): string { return serverSecret; }

/** Server output captured so far, for diagnosing a surprising 500. */
export function serverOutput(): string { return serverLog; }

// ─── people and fixtures ─────────────────────────────────────────────────────

let hashPromise: Promise<string> | null = null;
function pinHash(): Promise<string> {
  hashPromise ??= bcrypt.hash(PIN, 4);
  return hashPromise;
}

export function fakePhone(): string {
  phoneSeq += 1;
  return `+65800${String(10000 + phoneSeq).padStart(5, '0')}`; // +65 8000xxxx range, all fake
}

export async function login(phone: string): Promise<string> {
  const res = await fetch(`${env.base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, pin: PIN }),
  });
  const cookie = sessionCookie(res);
  if (!cookie) throw new Error(`login for ${phone} gave no session cookie (status ${res.status}): ${await res.text()}`);
  return cookie;
}

function sessionCookie(res: Response): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = /^(cafeos_session=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

function person(id: string, phone: string, cafeId: string | null): Person {
  let cached: Promise<string> | null = null;
  return { id, phone, cafeId, cookie: () => (cached ??= login(phone)) };
}

interface NewPersonOpts { name?: string; superAdmin?: boolean; active?: boolean; pinSet?: boolean }

async function insertProfile(name: string, o: NewPersonOpts = {}): Promise<{ id: string; phone: string }> {
  const phone = fakePhone();
  const { rows } = await env.pool.query(
    `INSERT INTO profiles (phone_e164, full_name, pin_hash, is_active, is_super_admin, pin_set_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [phone, name, await pinHash(), o.active ?? true, o.superAdmin ?? false, (o.pinSet ?? true) ? new Date() : null],
  );
  return { id: rows[0].id, phone };
}

export async function addMembership(userId: string, cafeId: string, role: Role, extra: { employmentActive?: boolean; status?: string } = {}) {
  await env.pool.query(
    `INSERT INTO cafe_memberships (cafe_id, user_id, role, status, employment_active) VALUES ($1, $2, $3, $4, $5)`,
    [cafeId, userId, role, extra.status ?? 'active', extra.employmentActive ?? true],
  );
}

export async function newCafe(status: 'active' | 'pending' | 'suspended'): Promise<string> {
  const slug = `http-${randomBytes(5).toString('hex')}`;
  const { rows } = await env.pool.query(`INSERT INTO cafes (slug, name, status) VALUES ($1, $2, $3) RETURNING id`, [slug, `Cafe ${slug}`, status]);
  return rows[0].id;
}

/** A fresh member of a cafe (default cafe one). Each case makes its own so balances never collide. */
export async function newMember(role: Role, cafeId: string = env.cafe1, extra: { employmentActive?: boolean } = {}): Promise<Person> {
  const p = await insertProfile(`HTTP ${role}`);
  await addMembership(p.id, cafeId, role, extra);
  return person(p.id, p.phone, cafeId);
}

/** A cafe in the given state with one owner who can sign in (unless pending). */
export async function newCafeWithOwner(status: 'active' | 'pending' | 'suspended', owner: NewPersonOpts = {}): Promise<{ cafeId: string; owner: Person }> {
  const cafeId = await newCafe(status);
  const p = await insertProfile('HTTP owner', owner);
  await addMembership(p.id, cafeId, 'owner', { status: status === 'pending' ? 'pending' : 'active' });
  return { cafeId, owner: person(p.id, p.phone, cafeId) };
}

async function seedFixtures(): Promise<void> {
  env.cafe1 = await newCafe('active');
  env.cafe2 = await newCafe('active');
  env.pendingCafe = await newCafe('pending');
  const mk = async (name: string, cafeId: string | null, role: Role | null, extra: { employmentActive?: boolean } = {}, o: NewPersonOpts = {}) => {
    const p = await insertProfile(name, o);
    if (cafeId && role) await addMembership(p.id, cafeId, role, extra);
    return person(p.id, p.phone, cafeId);
  };
  const owner = await mk('Fixture owner', env.cafe1, 'owner');
  const manager = await mk('Fixture manager', env.cafe1, 'manager');
  const staff = await mk('Fixture staff', env.cafe1, 'staff');
  const partTimer = await mk('Fixture part-timer', env.cafe1, 'part_timer');
  const owner2 = await mk('Fixture owner two', env.cafe2, 'owner');
  const inactive = await mk('Fixture inactive member', env.cafe1, 'staff', { employmentActive: false });
  const sup = await mk('Fixture super admin', null, null, {}, { superAdmin: true });
  const multi = await mk('Fixture two-cafe member', env.cafe1, 'staff');
  await addMembership(multi.id, env.cafe2, 'staff');
  Object.assign(env, { people: { owner, manager, staff, partTimer, owner2, inactive, super: sup, multi } });
  // The pending cafe gets an owner too, as /api/start would create it.
  const pend = await insertProfile('Fixture pending owner', { active: false, pinSet: false });
  await addMembership(pend.id, env.pendingCafe, 'owner', { status: 'pending' });
}

// ─── http ────────────────────────────────────────────────────────────────────

export interface Reply { status: number; json: Json; headers: Headers }

/** Call the running server. `as` is who signs the request (null/undefined = signed out). */
export async function api(method: string, urlPath: string, o: { as?: Person | null; cookie?: string; body?: unknown; raw?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (o.as) headers.cookie = await o.as.cookie();
  if (o.cookie) headers.cookie = o.cookie;
  let body: string | undefined;
  if (o.raw !== undefined) { body = o.raw; headers['content-type'] = 'application/json'; }
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['content-type'] = 'application/json'; }
  const res = await fetch(`${env.base}${urlPath}`, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json: Json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { _text: text.slice(0, 200) }; }
  return { status: res.status, json, headers: res.headers };
}

export async function row<T = Json>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await env.pool.query(text, params);
  return r.rows[0] as T | undefined;
}

export async function rows<T = Json>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await env.pool.query(text, params)).rows as T[];
}

/** Distinct month per call ('3000-01', '3001-01', ...): unique timesheet months and non-overlapping dates. */
let monthSeq = 0;
export function nextYear(): number { monthSeq += 1; return 3000 + monthSeq; }
