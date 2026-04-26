/**
 * Phone+PIN auth: JWT cookie session + bcrypt PIN hashing + lockout helpers.
 *
 *   await login(phoneE164, pin)            // verify PIN, set cookie, return user
 *   await logout()                          // clear cookie
 *   await getCurrentUser()                  // read cookie -> user row | null
 *   await requireOwner() / requireManager() // throws Forbidden if missing
 *
 * Cookie: HS256 JWT, 7-day rolling, httpOnly, sameSite=lax.
 * Lockout: 5 failed attempts -> locked_until = now + 15min. Successful login clears it.
 */

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/validators';

const COOKIE_NAME = 'cafeos_session';
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const BCRYPT_COST = 12;

export class AuthError extends Error {
  constructor(public code: 'invalid_credentials' | 'locked' | 'inactive' | 'unauthorized' | 'forbidden', message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SessionUser {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: Role;
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: number | null;
  is_active: boolean;
  email: string | null;
}

interface JwtClaims {
  sub: string; // profile id
  role: Role;
  iat?: number;
  exp?: number;
}

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET env var must be set and at least 32 characters');
  }
  return new TextEncoder().encode(s);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

async function signSession(claims: JwtClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE_SEC}s`)
    .sign(getSecret());
}

async function verifySession(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    return { sub: payload.sub, role: payload.role as Role, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

interface LoginRow {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: Role;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: string | null; // numeric -> string from pg
  is_active: boolean;
  email: string | null;
}

function rowToUser(r: LoginRow): SessionUser {
  return {
    id: r.id,
    phone_e164: r.phone_e164,
    full_name: r.full_name,
    job_title: r.job_title,
    role: r.role,
    annual_leave_balance: r.annual_leave_balance,
    medical_leave_balance: r.medical_leave_balance,
    hourly_rate: r.hourly_rate === null ? null : Number(r.hourly_rate),
    is_active: r.is_active,
    email: r.email,
  };
}

export async function login(phoneE164: string, pin: string): Promise<SessionUser> {
  const { rows } = await sql<LoginRow>`
    SELECT id, phone_e164, full_name, job_title, role, pin_hash, failed_attempts,
           locked_until, annual_leave_balance, medical_leave_balance, hourly_rate,
           is_active, email
      FROM profiles
     WHERE phone_e164 = ${phoneE164}
     LIMIT 1
  `;
  const row = rows[0];

  // Constant-ish failure path so we don't leak whether the phone is registered.
  if (!row) {
    await bcrypt.compare(pin, '$2a$12$0000000000000000000000000000000000000000000000000000');
    throw new AuthError('invalid_credentials', 'Invalid phone or PIN');
  }

  if (!row.is_active) {
    throw new AuthError('inactive', 'This account is disabled. Contact your manager.');
  }

  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    throw new AuthError('locked', `Too many wrong attempts. Try again at ${lockedUntil.toLocaleTimeString()}.`);
  }

  const ok = await verifyPin(pin, row.pin_hash);
  if (!ok) {
    const next = row.failed_attempts + 1;
    if (next >= LOCKOUT_THRESHOLD) {
      await sql`
        UPDATE profiles
           SET failed_attempts = ${next},
               locked_until    = NOW() + (${LOCKOUT_MINUTES} || ' minutes')::interval
         WHERE id = ${row.id}
      `;
      throw new AuthError('locked', `Too many wrong attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
    }
    await sql`UPDATE profiles SET failed_attempts = ${next} WHERE id = ${row.id}`;
    throw new AuthError('invalid_credentials', 'Invalid phone or PIN');
  }

  // Success: reset counters
  if (row.failed_attempts > 0 || row.locked_until) {
    await sql`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = ${row.id}`;
  }

  const token = await signSession({ sub: row.id, role: row.role });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  });

  return rowToUser(row);
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionClaims(): Promise<JwtClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const claims = await getSessionClaims();
  if (!claims) return null;
  const { rows } = await sql<LoginRow>`
    SELECT id, phone_e164, full_name, job_title, role, pin_hash, failed_attempts,
           locked_until, annual_leave_balance, medical_leave_balance, hourly_rate,
           is_active, email
      FROM profiles
     WHERE id = ${claims.sub}
     LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.is_active) return null;
  return rowToUser(row);
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError('unauthorized', 'Not signed in');
  return u;
}

export async function requireManager(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'manager' && u.role !== 'owner') {
    throw new AuthError('forbidden', 'Manager or owner access required');
  }
  return u;
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'owner') {
    throw new AuthError('forbidden', 'Owner access required');
  }
  return u;
}

export async function requireSelfOrManager(targetUserId: string): Promise<SessionUser> {
  const u = await requireUser();
  if (u.id === targetUserId) return u;
  if (u.role === 'manager' || u.role === 'owner') return u;
  throw new AuthError('forbidden', 'Not allowed');
}

/**
 * Verify an incoming JWT cookie value without touching the DB. For middleware.
 * Returns null on invalid / missing.
 */
export async function verifySessionToken(token: string | undefined): Promise<JwtClaims | null> {
  if (!token) return null;
  return verifySession(token);
}

export const SESSION_COOKIE = COOKIE_NAME;
