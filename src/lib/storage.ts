/**
 * Vercel Blob storage for medical certificates.
 *
 * Pattern: server-side upload only. Clients POST a multipart form to
 * /api/medical-certs, the route validates auth + size + mime, then calls
 * uploadMedicalCert(). Reads always go through /api/medical-certs/[id]
 * which streams the file (or 302s to a short-lived blob URL) only if the
 * caller has access (own row or manager/owner).
 *
 * Path scheme: medical-certificates/{user_id}/{timestamp}-{filename}
 */

import { put, del } from '@vercel/blob';

const PREFIX = 'medical-certificates';

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
    access: 'public', // gated by app-layer auth on /api/medical-certs/[id]
    addRandomSuffix: false,
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
