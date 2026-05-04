import { NextResponse } from 'next/server';
import {
  requireUser,
  signFullSession,
  AuthError,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';
import { sql } from '@/lib/db';
import type { MembershipRole } from '@/lib/validators';

export const runtime = 'nodejs';

interface MembershipRow {
  cafe_id: string;
  cafe_slug: string;
  role: MembershipRole;
  cafe_status: string;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { cafeId } = (body ?? {}) as { cafeId?: unknown };
  if (typeof cafeId !== 'string') {
    return NextResponse.json({ error: 'cafeId is required' }, { status: 400 });
  }

  try {
    const user = await requireUser();

    const { rows } = await sql<MembershipRow>`
      SELECT m.cafe_id, c.slug AS cafe_slug, m.role, c.status AS cafe_status
        FROM cafe_memberships m
        JOIN cafes c ON c.id = m.cafe_id
       WHERE m.user_id = ${user.id}
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
      user.id,
      membership.cafe_id,
      membership.cafe_slug,
      membership.role,
      user.is_super_admin,
    );

    const res = NextResponse.json({ redirect: `/c/${membership.cafe_slug}/` });
    res.cookies.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_COOKIE_MAX_AGE });
    return res;
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('[switch-cafe]', e);
    return NextResponse.json({ error: 'Switch failed' }, { status: 500 });
  }
}
