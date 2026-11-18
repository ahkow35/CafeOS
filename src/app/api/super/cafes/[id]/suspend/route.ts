import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';
import { decideCafeMove, type CafeStatus } from '@/lib/workflows/cafe';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stillPending = () => NextResponse.json({ error: 'Pending cafes cannot be suspended' }, { status: 400 });

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { id: cafeId } = await params;
    if (!UUID_RE.test(cafeId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows: current } = await sql<{ status: CafeStatus }>`SELECT status FROM cafes WHERE id = ${cafeId}`;
    if (current.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
    if (!decideCafeMove(current[0].status, 'suspend').ok) return stillPending();

    // The status is part of the UPDATE itself, so a cafe that is pending by then is left as it is.
    const { rows } = await sql<{ status: string }>`
      UPDATE cafes SET status = 'suspended', admin_suspended_at = NOW(), updated_at = NOW()
       WHERE id = ${cafeId} AND status <> 'pending'
       RETURNING status
    `;
    if (rows.length === 0) {
      const { rows: now } = await sql`SELECT id FROM cafes WHERE id = ${cafeId}`;
      if (now.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
      return stillPending();
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id]/suspend POST error', e);
    return NextResponse.json({ error: 'Failed to suspend cafe' }, { status: 500 });
  }
}
