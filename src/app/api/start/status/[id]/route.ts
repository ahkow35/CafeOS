import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public, unauthenticated status poll for the /start page. Deliberately leaks
 * nothing beyond "still going" vs "done" for this one signup id — no phone,
 * name, token, or Telegram state, and no way to distinguish "in progress" from
 * "not found" or "expired".
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ status: 'pending' });

  const { rows } = await sql<{ status: string }>`
    SELECT status FROM cafe_signups WHERE id = ${id} LIMIT 1
  `;
  const status = rows[0]?.status === 'completed' ? 'completed' : 'pending';
  return NextResponse.json({ status });
}
