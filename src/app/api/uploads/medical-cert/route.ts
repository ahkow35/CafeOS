import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth';
import { uploadMedicalCert } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']);

export async function POST(req: Request) {
  try {
    const me = await requireUser();
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

    const { url, pathname } = await uploadMedicalCert({
      userId: me.id,
      file,
      filename: file.name || 'mc',
      contentType: file.type || undefined,
    });

    return NextResponse.json({ url, pathname });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('uploads/medical-cert error', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
