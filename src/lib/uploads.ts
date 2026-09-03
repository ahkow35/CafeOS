import { NextResponse } from 'next/server';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { uploadAttachment, type AttachmentKind } from '@/lib/storage';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']);

const DEFAULT_NAME: Record<AttachmentKind, string> = {
  'medical-cert': 'mc',
  'claim-receipt': 'receipt',
};

/**
 * Shared body for /api/uploads/* routes: authenticate, gate size and mime type,
 * upload under the caller's own path for `kind`, return the blob URL.
 */
export async function handleAttachmentUpload(kind: AttachmentKind, req: Request): Promise<Response> {
  try {
    const ctx = await requireTenantUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit` }, { status: 413 });
    }
    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
    }

    const { url, pathname } = await uploadAttachment(kind, {
      userId: ctx.userId,
      cafeId: ctx.cafeId,
      file,
      filename: file.name || DEFAULT_NAME[kind],
      contentType: file.type || undefined,
    });

    return NextResponse.json({ url, pathname });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error(`uploads/${kind} error`, e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
