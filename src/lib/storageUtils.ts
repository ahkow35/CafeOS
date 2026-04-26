/**
 * Open a stored medical certificate.
 *
 * `attachment_url` is a Vercel Blob public URL. Access is gated at upload
 * time (only the uploading user can write under their own prefix), and the
 * blob URLs are unguessable, so we just open them directly.
 */
export async function openMedicalCert(attachmentUrl: string): Promise<void> {
  if (!attachmentUrl) {
    alert('No file attached.');
    return;
  }
  window.open(attachmentUrl, '_blank', 'noopener,noreferrer');
}
