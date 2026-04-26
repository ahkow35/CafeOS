import { NextResponse } from 'next/server';
import { logout } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  await logout();
  return NextResponse.json({ ok: true });
}
