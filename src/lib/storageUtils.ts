/**
 * Open a stored medical certificate.
 *
 * The server rewrites `attachment_url` to the gated read route
 * (/api/leave-requests/[id]/attachment), which authorizes the caller and
 * streams the file. The raw Vercel Blob URL is never sent to the client, so
 * opening this same-origin path is the only way to view a certificate.
 */
export async function openMedicalCert(attachmentUrl: string): Promise<void> {
  if (!attachmentUrl) {
    alert('No file attached.');
    return;
  }
  window.open(attachmentUrl, '_blank', 'noopener,noreferrer');
}
