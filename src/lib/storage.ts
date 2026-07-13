/**
 * Vercel Blob storage for medical certificates.
 *
 * Pattern: server-side upload only. The uploading user POSTs a multipart form to
 * /api/uploads/medical-cert; the route validates auth + size + mime, then calls
 * uploadMedicalCert() and returns the blob URL to that user so they can attach it
 * to their own leave request.
 *
 * Reads NEVER hand the raw blob URL to clients. The leave-request endpoints
 * rewrite `attachment_url` to the gated route /api/leave-requests/[id]/attachment,
 * which authorizes (own row or manager/owner) and streams the file. The blob is
 * created with a random suffix so the underlying public URL is unguessable as a
 * defense-in-depth fallback.
 *
 * Path scheme: medical-certificates/{cafe_id}/{user_id}/{timestamp}-{filename}-{suffix}
 */

import { put, del } from '@vercel/blob';

const PREFIX = 'medical-certificates';

// Vercel Blob public URLs live on this host suffix. Locking attachment fetches to
// it prevents SSRF: a client cannot make the server fetch an internal address by
// supplying a URL whose PATH matches but whose HOST is arbitrary.
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

/**
 * Validate a client-supplied attachment URL on WRITE: it must be https, on our
 * Blob host, and inside the caller's own certificate path for this café. This is
 * the gate that stops a user attaching another user's blob or an arbitrary URL.
 */
export function isValidOwnCertUrl(url: string, cafeId: string, userId: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.hostname !== BLOB_HOST_SUFFIX.slice(1) && !u.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  return u.pathname.startsWith(`/${PREFIX}/${cafeId}/${userId}/`);
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
export function certContentType(pathnameOrUrl: string): string {
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

export async function uploadMedicalCert(opts: {
  userId: string;
  cafeId: string;
  file: File | Blob;
  filename: string;
  contentType?: string;
}): Promise<{ url: string; pathname: string }> {
  const safeName = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${PREFIX}/${opts.cafeId}/${opts.userId}/${Date.now()}-${safeName}`;
  const result = await put(key, opts.file, {
    // Vercel Blob 0.27 only supports public access. Reads are gated by the
    // app-layer route; the random suffix makes the raw URL unguessable.
    access: 'public',
    addRandomSuffix: true,
    contentType: opts.contentType,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function deleteMedicalCert(urlOrPathname: string): Promise<void> {
  await del(urlOrPathname);
}

/**
 * Pull the user_id segment from a stored path. Used to verify ownership
 * before serving a download.
 */
export function ownerFromPath(pathname: string): string | null {
  const m = pathname.match(/^medical-certificates\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}
