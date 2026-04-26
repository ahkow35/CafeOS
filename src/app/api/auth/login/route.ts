import { NextResponse } from 'next/server';
import { login, AuthError } from '@/lib/auth';
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
    const user = await login(phoneE164, pinStr);
    return NextResponse.json({ user });
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
