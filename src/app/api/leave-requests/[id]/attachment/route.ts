import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { isTrustedBlobUrl, certContentType } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/leave-requests/[id]/attachment
 *
 * Streams a leave request's medical certificate to authorized callers only:
 * the requester, or a manager/owner of the same cafe. The raw Vercel Blob URL
 * is never exposed to the client — this route fetches it server-side and pipes
 * the bytes back, so the only way to view a certificate is through this auth gate.
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

    // Defense in depth: never fetch anything but an https URL on our Blob host,
    // even if a malformed value somehow reached the DB. Closes SSRF at read time.
    if (!isTrustedBlobUrl(row.attachment_url)) {
      console.error('attachment rejected: untrusted URL', id);
      return NextResponse.json({ error: 'Attachment unavailable' }, { status: 502 });
    }

    const upstream = await fetch(row.attachment_url);
    if (!upstream.ok || !upstream.body) {
      console.error('attachment fetch failed', id, upstream.status);
      return NextResponse.json({ error: 'Attachment unavailable' }, { status: 502 });
    }

    // Serve as a forced download with a type derived from the path (never the
    // upstream header) and nosniff, so a file cannot execute as HTML on our origin.
    const headers = new Headers();
    headers.set('Content-Type', certContentType(row.attachment_url));
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Content-Disposition', 'attachment');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Cache-Control', 'private, no-store');

    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests attachment GET error', e);
    return NextResponse.json({ error: 'Failed to load attachment' }, { status: 500 });
  }
}
