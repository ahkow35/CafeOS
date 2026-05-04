/**
 * Phone+PIN auth with multi-tenant JWT session.
 *
 * Two cookies:
 *   cafeos_session — full session; carries sub, cafe_id, cafe_slug, role,
 *                    is_super_admin. 7-day rolling. Set after a user has
 *                    chosen their active cafe (or has only one / is super-only).
 *   cafeos_pick    — pre-selection token; 5 min. Set only when a user has
 *                    multiple destinations after login. Contains sub only.
 *
 * Key helpers:
 *   requireTenantUser()        → TenantCtx  (needs active cafe, raises if suspended)
 *   requireSuperAdmin()        → SessionUser (is_super_admin=true, no cafe needed)
 *   requireOwnerInCafe(ctx)    → asserts role is 'owner'
 *   requireManagerInCafe(ctx)  → asserts role is 'manager' | 'owner'
 */

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import type { TenantCtx } from '@/lib/db';
import type { MembershipRole } from '@/lib/validators';
type Role = MembershipRole; // local alias for SessionUser.role field

export type { TenantCtx };

export const SESSION_COOKIE = 'cafeos_session';
export const PICK_COOKIE = 'cafeos_pick';

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const PICK_COOKIE_MAX_AGE = 60 * 5;                      // 5 minutes
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const BCRYPT_COST = 12;

export class AuthError extends Error {
  constructor(
    public code:
      | 'invalid_credentials'
      | 'locked'
      | 'inactive'
      | 'unauthorized'
      | 'forbidden'
      | 'no_active_membership'
      | 'cafe_suspended'
      | 'cafe_pending'
      | 'need_cafe_selection',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface CafeInfo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

export interface MembershipInfo {
  cafe: CafeInfo;
  role: MembershipRole;
}

/** Shape of the full cafeos_session JWT payload. */
interface SessionClaims {
  sub: string;
  cafe_id: string | null;
  cafe_slug: string | null;
  role: MembershipRole | null;
  is_super_admin: boolean;
  impersonator_id?: string;
}

/** Shape of the cafeos_pick JWT payload (pre-selection). */
interface PickClaims {
  sub: string;
  pick: true;
}

export interface SessionUser {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: Role | null;        // role in active cafe; null for super-admin-only sessions
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: number | null;
  is_active: boolean;
  is_super_admin: boolean;
  email: string | null;
  telegram_chat_id: string | null;
  active_cafe: CafeInfo | null;
  memberships: MembershipInfo[];
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be ≥32 characters');
  return new TextEncoder().encode(s);
}

async function signSessionJwt(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    cafe_id: claims.cafe_id,
    cafe_slug: claims.cafe_slug,
    role: claims.role,
    is_super_admin: claims.is_super_admin,
    ...(claims.impersonator_id ? { impersonator_id: claims.impersonator_id } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_COOKIE_MAX_AGE}s`)
    .sign(getSecret());
}

async function signPickJwt(sub: string): Promise<string> {
  return new SignJWT({ pick: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${PICK_COOKIE_MAX_AGE}s`)
    .sign(getSecret());
}

async function verifySessionJwt(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      cafe_id: (payload.cafe_id as string | null) ?? null,
      cafe_slug: (payload.cafe_slug as string | null) ?? null,
      role: (payload.role as MembershipRole | null) ?? null,
      is_super_admin: Boolean(payload.is_super_admin),
      impersonator_id: payload.impersonator_id as string | undefined,
    };
  } catch {
    return null;
  }
}

async function verifyPickJwt(token: string): Promise<PickClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== 'string' || payload.pick !== true) return null;
    return { sub: payload.sub, pick: true };
  } catch {
    return null;
  }
}

/** Middleware-safe: verifies JWT from raw token without DB access. */
export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  return verifySessionJwt(token);
}

// ─── PIN helpers ──────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  email: string | null;
  telegram_chat_id: string | null;
}

interface MembershipRow {
  cafe_id: string;
  cafe_slug: string;
  cafe_name: string;
  cafe_logo_url: string | null;
  role: MembershipRole;
}

// ─── login ────────────────────────────────────────────────────────────────────

export type LoginResult =
  | { kind: 'session'; user: SessionUser; token: string }
  | { kind: 'pick'; sub: string; pickToken: string; memberships: MembershipInfo[]; isSuperAdmin: boolean };

/**
 * Verify phone+PIN, return either a full session token (single destination) or
 * a short-lived pick token (multiple destinations). Route handlers consume this
 * to set the appropriate cookie(s).
 */
export async function login(phoneE164: string, pin: string): Promise<LoginResult> {
  const { rows } = await sql<ProfileRow>`
    SELECT id, phone_e164, full_name, job_title, pin_hash, failed_attempts,
           locked_until, annual_leave_balance, medical_leave_balance, hourly_rate,
           is_active, is_super_admin, email, telegram_chat_id
      FROM profiles
     WHERE phone_e164 = ${phoneE164}
     LIMIT 1
  `;
  const row = rows[0];

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

  if (row.failed_attempts > 0 || row.locked_until) {
    await sql`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = ${row.id}`;
  }

  // Fetch active memberships.
  const { rows: memRows } = await sql<MembershipRow>`
    SELECT m.cafe_id, c.slug AS cafe_slug, c.name AS cafe_name,
           c.logo_url AS cafe_logo_url, m.role
      FROM cafe_memberships m
      JOIN cafes c ON c.id = m.cafe_id
     WHERE m.user_id = ${row.id}
       AND m.status  = 'active'
       AND c.status  = 'active'
     ORDER BY c.name
  `;

  const memberships: MembershipInfo[] = memRows.map((m) => ({
    cafe: { id: m.cafe_id, slug: m.cafe_slug, name: m.cafe_name, logo_url: m.cafe_logo_url },
    role: m.role,
  }));

  // Determine destinations: memberships ∪ (super-admin implicit /super seat)
  const destinations = memberships.length;

  if (!row.is_super_admin && destinations === 0) {
    throw new AuthError('no_active_membership', 'No active cafe membership. Contact your owner.');
  }

  // One destination → issue full session immediately.
  if (destinations === 1 && !row.is_super_admin) {
    const m = memberships[0];
    const token = await signSessionJwt({
      sub: row.id,
      cafe_id: m.cafe.id,
      cafe_slug: m.cafe.slug,
      role: m.role,
      is_super_admin: false,
    });
    return { kind: 'session', user: buildUser(row, m.cafe, m.role, memberships), token };
  }

  // Super admin with exactly one cafe — land them there (they can visit /super later).
  if (row.is_super_admin && destinations === 1) {
    const m = memberships[0];
    const token = await signSessionJwt({
      sub: row.id,
      cafe_id: m.cafe.id,
      cafe_slug: m.cafe.slug,
      role: m.role,
      is_super_admin: true,
    });
    return { kind: 'session', user: buildUser(row, m.cafe, m.role, memberships), token };
  }

  // Super admin with zero cafe memberships — land at /super with no cafe context.
  if (row.is_super_admin && destinations === 0) {
    const token = await signSessionJwt({
      sub: row.id,
      cafe_id: null,
      cafe_slug: null,
      role: null,
      is_super_admin: true,
    });
    return { kind: 'session', user: buildUser(row, null, null, []), token };
  }

  // Multiple destinations → issue pick token; caller sets cafeos_pick cookie.
  const pickToken = await signPickJwt(row.id);
  return { kind: 'pick', sub: row.id, pickToken, memberships, isSuperAdmin: row.is_super_admin };
}

function buildUser(
  row: ProfileRow,
  cafe: CafeInfo | null,
  role: MembershipRole | null,
  memberships: MembershipInfo[],
): SessionUser {
  return {
    id: row.id,
    phone_e164: row.phone_e164,
    full_name: row.full_name,
    job_title: row.job_title,
    role,
    annual_leave_balance: row.annual_leave_balance,
    medical_leave_balance: row.medical_leave_balance,
    hourly_rate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    is_active: row.is_active,
    is_super_admin: row.is_super_admin,
    email: row.email,
    telegram_chat_id: row.telegram_chat_id,
    active_cafe: cafe,
    memberships,
  };
}

// ─── session reading ──────────────────────────────────────────────────────────

async function getSessionClaimsFromCookies(): Promise<SessionClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionJwt(token);
}

async function getPickClaimsFromCookies(): Promise<PickClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PICK_COOKIE)?.value;
  if (!token) return null;
  return verifyPickJwt(token);
}

/** Full user including membership list. Used by /api/auth/me. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const claims = await getSessionClaimsFromCookies();
  if (!claims) return null;

  const { rows } = await sql<ProfileRow>`
    SELECT id, phone_e164, full_name, job_title, '' AS pin_hash,
           0 AS failed_attempts, NULL AS locked_until,
           annual_leave_balance, medical_leave_balance, hourly_rate,
           is_active, is_super_admin, email, telegram_chat_id
      FROM profiles
     WHERE id = ${claims.sub}
     LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.is_active) return null;

  const { rows: memRows } = await sql<MembershipRow>`
    SELECT m.cafe_id, c.slug AS cafe_slug, c.name AS cafe_name,
           c.logo_url AS cafe_logo_url, m.role
      FROM cafe_memberships m
      JOIN cafes c ON c.id = m.cafe_id
     WHERE m.user_id = ${row.id}
       AND m.status  = 'active'
       AND c.status  = 'active'
     ORDER BY c.name
  `;
  const memberships: MembershipInfo[] = memRows.map((m) => ({
    cafe: { id: m.cafe_id, slug: m.cafe_slug, name: m.cafe_name, logo_url: m.cafe_logo_url },
    role: m.role,
  }));

  const activeCafe: CafeInfo | null = claims.cafe_id
    ? memberships.find((m) => m.cafe.id === claims.cafe_id)?.cafe ?? null
    : null;
  const activeRole: MembershipRole | null = claims.cafe_id
    ? memberships.find((m) => m.cafe.id === claims.cafe_id)?.role ?? null
    : null;

  return buildUser(row, activeCafe, activeRole, memberships);
}

// ─── route-level guards ───────────────────────────────────────────────────────

export async function requireUser(): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError('unauthorized', 'Not signed in');
  return u;
}

/**
 * The primary guard for all tenant-scoped route handlers.
 * Returns a TenantCtx with cafeId, cafeSlug, role, isSuperAdmin.
 * Throws if:
 *   - No session
 *   - Session has no active cafe (super-admin-only sessions need requireSuperAdmin instead)
 *   - The membership is no longer active or cafe is suspended
 */
export async function requireTenantUser(): Promise<TenantCtx> {
  const claims = await getSessionClaimsFromCookies();
  if (!claims) throw new AuthError('unauthorized', 'Not signed in');
  if (!claims.cafe_id || !claims.cafe_slug || !claims.role) {
    throw new AuthError('need_cafe_selection', 'No active cafe — go to /login/select');
  }

  // Validate the membership is still active (catches suspension after session issue).
  const { rows } = await sql<{ role: MembershipRole; cafe_status: string }>`
    SELECT m.role, c.status AS cafe_status
      FROM cafe_memberships m
      JOIN cafes c ON c.id = m.cafe_id
     WHERE m.user_id = ${claims.sub}
       AND m.cafe_id = ${claims.cafe_id}
       AND m.status  = 'active'
     LIMIT 1
  `;
  const membership = rows[0];
  if (!membership) {
    throw new AuthError('no_active_membership', 'Your membership in this cafe is no longer active');
  }
  if (membership.cafe_status === 'suspended') {
    throw new AuthError('cafe_suspended', 'This cafe has been suspended');
  }
  if (membership.cafe_status === 'pending') {
    throw new AuthError('cafe_pending', 'This cafe is pending approval');
  }

  return {
    userId: claims.sub,
    cafeId: claims.cafe_id,
    cafeSlug: claims.cafe_slug,
    role: membership.role, // re-read from DB — JWT role could be stale after role change
    isSuperAdmin: claims.is_super_admin,
    impersonatorId: claims.impersonator_id,
  };
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const claims = await getSessionClaimsFromCookies();
  if (!claims) throw new AuthError('unauthorized', 'Not signed in');
  if (!claims.is_super_admin) throw new AuthError('forbidden', 'Super admin access required');
  const u = await getCurrentUser();
  if (!u) throw new AuthError('unauthorized', 'Not signed in');
  return u;
}

export function requireOwnerInCafe(ctx: TenantCtx): void {
  if (ctx.role !== 'owner') {
    throw new AuthError('forbidden', 'Owner access required');
  }
}

export function requireManagerInCafe(ctx: TenantCtx): void {
  if (ctx.role !== 'manager' && ctx.role !== 'owner') {
    throw new AuthError('forbidden', 'Manager or owner access required');
  }
}

export function requireSelfOrManagerInCafe(ctx: TenantCtx, targetUserId: string): void {
  if (ctx.userId === targetUserId) return;
  if (ctx.role === 'manager' || ctx.role === 'owner') return;
  throw new AuthError('forbidden', 'Not allowed');
}

// ─── token signing helpers exposed for select-cafe / switch-cafe routes ───────

export async function signFullSession(
  sub: string,
  cafeId: string | null,
  cafeSlug: string | null,
  role: MembershipRole | null,
  isSuperAdmin: boolean,
  impersonatorId?: string,
): Promise<string> {
  return signSessionJwt({ sub, cafe_id: cafeId, cafe_slug: cafeSlug, role, is_super_admin: isSuperAdmin, impersonator_id: impersonatorId });
}

export async function signPickToken(sub: string): Promise<string> {
  return signPickJwt(sub);
}

/** Read and verify the pick cookie — used by /api/auth/select-cafe. */
export async function getPickClaims(): Promise<PickClaims | null> {
  return getPickClaimsFromCookies();
}

// Legacy compat aliases — used by existing /api/admin/* routes until Phase D rewrites them.
export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'owner') throw new AuthError('forbidden', 'Owner access required');
  return u;
}

export async function requireManager(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'manager' && u.role !== 'owner') {
    throw new AuthError('forbidden', 'Manager or owner access required');
  }
  return u;
}

export async function requireSelfOrManager(targetUserId: string): Promise<SessionUser> {
  const u = await requireUser();
  if (u.id === targetUserId) return u;
  if (u.role === 'manager' || u.role === 'owner') return u;
  throw new AuthError('forbidden', 'Not allowed');
}
