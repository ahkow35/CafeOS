import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { streamGatedAttachment } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/claims/[id]/receipt
 * Streams the receipt to the claimant or a manager/owner of the same café.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ user_id: string; receipt_url: string }>`
      SELECT user_id, receipt_url FROM medical_claims
       WHERE id = ${id} AND cafe_id = ${ctx.cafeId}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });

    const isOwnRow = row.user_id === ctx.userId;
    const isManagerOrOwner = ctx.role === 'manager' || ctx.role === 'owner';
    if (!isOwnRow && !isManagerOrOwner) {
      throw new AuthError('forbidden', 'Not allowed to view this receipt');
    }

    return streamGatedAttachment(row.receipt_url, id);
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('claims receipt GET error', e);
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 });
  }
}
