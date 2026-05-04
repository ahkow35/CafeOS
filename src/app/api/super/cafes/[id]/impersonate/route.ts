import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import {
  requireSuperAdmin,
  signFullSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
  AuthError,
} from '@/lib/auth';
import type { MembershipRole } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireSuperAdmin();
    const { id: cafeId } = await params;
    if (!UUID_RE.test(cafeId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: { userId?: unknown };
    try {
      body = (await req.json()) as { userId?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const targetUserId = body.userId;
    if (typeof targetUserId !== 'string' || !UUID_RE.test(targetUserId)) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Verify the target has an active membership in this cafe.
    const { rows } = await sql<{ role: MembershipRole; cafe_slug: string }>`
      SELECT m.role, c.slug AS cafe_slug
        FROM cafe_memberships m
        JOIN cafes c ON c.id = m.cafe_id
       WHERE m.user_id = ${targetUserId}
         AND m.cafe_id = ${cafeId}
         AND m.status = 'active'
         AND c.status = 'active'
       LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User has no active membership in this cafe' }, { status: 404 });
    }
    const { role, cafe_slug } = rows[0];

    const token = await signFullSession(
      targetUserId,
      cafeId,
      cafe_slug,
      role,
      false,           // impersonated user is not a super admin
      admin.id,        // impersonator_id — stamped on every audit_log row during this session
    );

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_COOKIE_MAX_AGE,
    });

    return NextResponse.json({ ok: true, redirect: `/c/${cafe_slug}/` });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id]/impersonate POST error', e);
    return NextResponse.json({ error: 'Failed to impersonate' }, { status: 500 });
  }
}
