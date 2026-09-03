/**
 * Vercel Blob storage for user attachments (medical certificates, claim receipts).
 *
 * Pattern: server-side upload only. The uploading user POSTs a multipart form to
 * an /api/uploads/* route; the route validates auth + size + mime, then calls
 * uploadAttachment() and returns the blob URL to that user so they can attach it
 * to their own record.
 *
 * Reads NEVER hand the raw blob URL to clients. Record endpoints rewrite the URL
 * to a gated route (e.g. /api/leave-requests/[id]/attachment) which authorizes
 * and streams the file via streamGatedAttachment(). The blob is created with a
 * random suffix so the underlying public URL is unguessable as defense in depth.
 *
 * Path scheme: {prefix}/{cafe_id}/{user_id}/{timestamp}-{filename}-{suffix}
 */

import { put, del } from '@vercel/blob';

export type AttachmentKind = 'medical-cert' | 'claim-receipt';

const PREFIX: Record<AttachmentKind, string> = {
  'medical-cert': 'medical-certificates',
  'claim-receipt': 'claim-receipts',
};

// Vercel Blob public URLs live on this host suffix. Locking attachment fetches to
// it prevents SSRF: a client cannot make the server fetch an internal address by
// supplying a URL whose PATH matches but whose HOST is arbitrary.
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

/**
 * Validate a client-supplied attachment URL on WRITE: it must be https, on our
 * Blob host, and inside the caller's own path for this kind and café. This is
 * the gate that stops a user attaching another user's blob or an arbitrary URL.
 */
export function isValidOwnAttachmentUrl(kind: AttachmentKind, url: string, cafeId: string, userId: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.hostname !== BLOB_HOST_SUFFIX.slice(1) && !u.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  return u.pathname.startsWith(`/${PREFIX[kind]}/${cafeId}/${userId}/`);
}

/** Defense-in-depth check on READ: only ever fetch https URLs on our Blob host. */
export function isTrustedBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/** Safe Content-Type for serving, derived from the path extension (never trust upstream). */
export function attachmentContentType(pathnameOrUrl: string): string {
  const ext = pathnameOrUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'heic': return 'image/heic';
    default: return 'application/octet-stream';
  }
}

export async function uploadAttachment(
  kind: AttachmentKind,
  opts: { userId: string; cafeId: string; file: File | Blob; filename: string; contentType?: string },
): Promise<{ url: string; pathname: string }> {
  const safeName = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${PREFIX[kind]}/${opts.cafeId}/${opts.userId}/${Date.now()}-${safeName}`;
  const result = await put(key, opts.file, {
    // Vercel Blob 0.27 only supports public access. Reads are gated by the
    // app-layer route; the random suffix makes the raw URL unguessable.
    access: 'public',
    addRandomSuffix: true,
    contentType: opts.contentType,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function deleteAttachment(urlOrPathname: string): Promise<void> {
  await del(urlOrPathname);
}

/**
 * Fetch a stored attachment server-side and stream it back as a forced download.
 * Callers MUST have already authorized the requester. `logId` is only used in
 * error logs so a failure can be traced to a record without leaking the URL.
 */
export async function streamGatedAttachment(url: string, logId: string): Promise<Response> {
  // Defense in depth: never fetch anything but an https URL on our Blob host,
  // even if a malformed value somehow reached the DB. Closes SSRF at read time.
  if (!isTrustedBlobUrl(url)) {
    console.error('attachment rejected: untrusted URL', logId);
    return Response.json({ error: 'Attachment unavailable' }, { status: 502 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    console.error('attachment fetch failed', logId, upstream.status);
    return Response.json({ error: 'Attachment unavailable' }, { status: 502 });
  }

  // Serve as a forced download with a type derived from the path (never the
  // upstream header) and nosniff, so a file cannot execute as HTML on our origin.
  const headers = new Headers();
  headers.set('Content-Type', attachmentContentType(url));
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  headers.set('Content-Disposition', 'attachment');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');

  return new Response(upstream.body, { status: 200, headers });
}
