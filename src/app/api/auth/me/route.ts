import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({ user: user ?? null });
  } catch (err) {
    console.error('[/api/auth/me]', err);
    // Return 503 so the client distinguishes a transient DB error from "no session".
    return NextResponse.json({ error: 'profile_unavailable' }, { status: 503 });
  }
}
