import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';
import { decideCafeMove, type CafeStatus } from '@/lib/workflows/cafe';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ status: CafeStatus }>`
      SELECT status FROM cafes WHERE id = ${id}
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
    if (!decideCafeMove(rows[0].status, 'reject').ok) {
      return NextResponse.json({ error: 'Only pending cafes can be rejected' }, { status: 400 });
    }

    // The status is part of the DELETE itself, so the cafe is removed only if it is still pending.
    const { rows: removed } = await sql`DELETE FROM cafes WHERE id = ${id} AND status = 'pending' RETURNING id`;
    if (removed.length === 0) {
      const { rows: now } = await sql`SELECT id FROM cafes WHERE id = ${id}`;
      if (now.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
      return NextResponse.json({ error: 'Only pending cafes can be rejected' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('cafe reject error', e);
    return NextResponse.json({ error: 'Failed to reject cafe' }, { status: 500 });
  }
}
