import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin();
    const { id } = await params;

    const { rows } = await sql<{ status: string }>`
      SELECT status FROM cafes WHERE id = ${id}
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
    if (rows[0].status !== 'pending') {
      return NextResponse.json({ error: 'Only pending cafes can be rejected' }, { status: 400 });
    }

    await sql`DELETE FROM cafes WHERE id = ${id}`;

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('cafe reject error', e);
    return NextResponse.json({ error: 'Failed to reject cafe' }, { status: 500 });
  }
}
