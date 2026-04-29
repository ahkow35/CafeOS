import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  // Clear via NextResponse.cookies for the same reason login uses it: it's the
  // only reliable way to attach Set-Cookie to a Route Handler response.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return res;
}
