import { NextResponse } from 'next/server';
import {
  getPickClaims,
  signFullSession,
  AuthError,
  SESSION_COOKIE,
  PICK_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';
import { sql } from '@/lib/db';
import type { MembershipRole } from '@/lib/validators';

export const runtime = 'nodejs';

interface MembershipRow {
  cafe_id: string;
  cafe_slug: string;
  cafe_name: string;
  cafe_logo_url: string | null;
  role: MembershipRole;
  cafe_status: string;
}

interface ProfileRow {
  is_super_admin: boolean;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cafeId, goSuper } = (body ?? {}) as { cafeId?: unknown; goSuper?: unknown };

  try {
    const pickClaims = await getPickClaims();
    if (!pickClaims) {
      return NextResponse.json({ error: 'Session expired — please log in again', code: 'pick_expired' }, { status: 401 });
    }

    const sub = pickClaims.sub;

    const { rows: profileRows } = await sql<ProfileRow>`
      SELECT is_super_admin FROM profiles WHERE id = ${sub} AND is_active = TRUE LIMIT 1
    `;
    const profile = profileRows[0];
    if (!profile) return NextResponse.json({ error: 'Account not found' }, { status: 401 });

    // Super admin choosing to go to /super instead of a cafe.
    if (goSuper === true) {
      if (!profile.is_super_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const token = await signFullSession(sub, null, null, null, true);
      const res = NextResponse.json({ redirect: '/super' });
      res.cookies.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_COOKIE_MAX_AGE });
      res.cookies.set(PICK_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
      return res;
    }

    if (typeof cafeId !== 'string') {
      return NextResponse.json({ error: 'cafeId is required' }, { status: 400 });
    }

    // Validate the user actually has an active membership in the chosen cafe.
    const { rows } = await sql<MembershipRow>`
      SELECT m.cafe_id, c.slug AS cafe_slug, c.name AS cafe_name,
             c.logo_url AS cafe_logo_url, m.role, c.status AS cafe_status
        FROM cafe_memberships m
        JOIN cafes c ON c.id = m.cafe_id
       WHERE m.user_id = ${sub}
         AND m.cafe_id = ${cafeId}
         AND m.status  = 'active'
       LIMIT 1
    `;
    const membership = rows[0];
    if (!membership) {
      return NextResponse.json({ error: 'No active membership in this cafe', code: 'no_membership' }, { status: 403 });
    }
    if (membership.cafe_status !== 'active') {
      return NextResponse.json({ error: 'This cafe is not currently active', code: 'cafe_not_active' }, { status: 403 });
    }

    const token = await signFullSession(
      sub,
      membership.cafe_id,
      membership.cafe_slug,
      membership.role,
      profile.is_super_admin,
    );

    const res = NextResponse.json({ redirect: `/c/${membership.cafe_slug}/` });
    res.cookies.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_COOKIE_MAX_AGE });
    res.cookies.set(PICK_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 401 });
    }
    console.error('[select-cafe]', e);
    return NextResponse.json({ error: 'Selection failed' }, { status: 500 });
  }
}
