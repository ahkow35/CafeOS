import { handleAttachmentUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handleAttachmentUpload('claim-receipt', req);
}
