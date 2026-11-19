import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { lookupCafeAccess } from '@/lib/cafeAccess';
import {
  requireSuperAdmin,
  signFullSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  AuthError,
} from '@/lib/auth';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Impersonation sessions are short-lived — they should not outlive the admin's
// working window the way a normal 7-day session does.
const IMPERSONATION_MAX_AGE = 60 * 60; // 1 hour

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

    // Verify the target has access to this cafe (one rule: src/lib/cafeAccess.ts).
    // Disabled users must not be impersonable.
    const access = await lookupCafeAccess(targetUserId, cafeId);
    if (!access || access.verdict !== 'ok') {
      return NextResponse.json({ error: 'User has no active membership in this cafe' }, { status: 404 });
    }
    const role = access.role!;
    const cafe_slug = access.cafeSlug!;

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
      maxAge: IMPERSONATION_MAX_AGE,
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
