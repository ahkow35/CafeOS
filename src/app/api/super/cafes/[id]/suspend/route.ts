import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireSuperAdmin, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSuperAdmin();
    const { id: cafeId } = await params;
    if (!UUID_RE.test(cafeId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ status: string }>`
      UPDATE cafes SET status = 'suspended', updated_at = NOW()
       WHERE id = ${cafeId}
       RETURNING status
    `;
    if (rows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id]/suspend POST error', e);
    return NextResponse.json({ error: 'Failed to suspend cafe' }, { status: 500 });
  }
}
