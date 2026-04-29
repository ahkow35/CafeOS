import { NextResponse } from 'next/server';
import {
  login,
  AuthError,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';
import { parseE164, parsePin, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

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
    const { user, token } = await login(phoneE164, pinStr);

    // Attach Set-Cookie directly to the response — the only reliable pattern
    // across Next.js 14/15/16 Route Handlers. Using cookies() from next/headers
    // had race-y interactions with the JSON response body and was the cause of
    // post-login "logged out on first navigation" symptoms.
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE, token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    return res;
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof AuthError) {
      const status = e.code === 'locked' ? 423 : e.code === 'inactive' ? 403 : 401;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('login error', e);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
