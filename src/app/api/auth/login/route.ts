import { NextResponse } from 'next/server';
import {
  login,
  AuthError,
  SESSION_COOKIE,
  PICK_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';
import { parseE164, parsePin, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const PICK_MAX_AGE = 60 * 5;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { phone, pin } = (body ?? {}) as { phone?: unknown; pin?: unknown };

  try {
    const phoneE164 = parseE164(phone);
    const pinStr = parsePin(pin);
    const result = await login(phoneE164, pinStr);

    if (result.kind === 'session') {
      const res = NextResponse.json({
        user: result.user,
        redirect: result.user.active_cafe
          ? `/c/${result.user.active_cafe.slug}/`
          : '/super',
      });
      res.cookies.set(SESSION_COOKIE, result.token, {
        ...SESSION_COOKIE_OPTIONS,
        maxAge: SESSION_COOKIE_MAX_AGE,
      });
      return res;
    }

    // kind === 'pick' — multiple cafes; let the client show a picker.
    const res = NextResponse.json({
      memberships: result.memberships,
      isSuperAdmin: result.isSuperAdmin,
      next: '/login/select',
    });
    res.cookies.set(PICK_COOKIE, result.pickToken, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: PICK_MAX_AGE,
    });
    return res;
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AuthError) {
      const status =
        e.code === 'locked' ? 423
        : e.code === 'inactive' ? 403
        : e.code === 'no_active_membership' ? 403
        : 401;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('[login]', e);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
