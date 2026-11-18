import { NextResponse } from 'next/server';
import {
  requireUser,
  signFullSession,
  AuthError,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';
import { lookupCafeAccess } from '@/lib/cafeAccess';

export const runtime = 'nodejs';

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

    // One rule for access to a cafe: src/lib/cafeAccess.ts.
    const access = await lookupCafeAccess(user.id, cafeId);
    if (!access || access.verdict === 'no_membership' || access.verdict === 'access_off' || access.verdict === 'profile_inactive') {
      return NextResponse.json({ error: 'No active membership in this cafe', code: 'no_membership' }, { status: 403 });
    }
    if (access.verdict === 'cafe_not_active') {
      return NextResponse.json({ error: 'This cafe is not currently active', code: 'cafe_not_active' }, { status: 403 });
    }

    const token = await signFullSession(
      user.id,
      access.cafeId!,
      access.cafeSlug!,
      access.role!,
      user.is_super_admin,
    );

    const res = NextResponse.json({ redirect: `/c/${access.cafeSlug}/` });
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
