import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { streamGatedAttachment } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/leave-requests/[id]/attachment
 *
 * Streams a leave request's medical certificate to authorized callers only:
 * the requester, or a manager/owner of the same cafe. The raw Vercel Blob URL
 * is never exposed to the client.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ user_id: string; attachment_url: string | null }>`
      SELECT user_id, attachment_url
        FROM leave_requests
       WHERE id = ${id} AND cafe_id = ${ctx.cafeId}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.attachment_url) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Requester may view their own; managers and owners may view anyone's in the cafe.
    const isOwnRow = row.user_id === ctx.userId;
    const isManagerOrOwner = ctx.role === 'manager' || ctx.role === 'owner';
    if (!isOwnRow && !isManagerOrOwner) {
      throw new AuthError('forbidden', 'Not allowed to view this attachment');
    }

    return streamGatedAttachment(row.attachment_url, id);
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests attachment GET error', e);
    return NextResponse.json({ error: 'Failed to load attachment' }, { status: 500 });
  }
}
