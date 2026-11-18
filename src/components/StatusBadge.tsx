import { statusLabel, TONE_CLASS, type StatusWorkflow } from '@/lib/workflows/labels';

/** The one badge every screen uses to show a status. A status the table does not know shows its raw text. */
export default function StatusBadge({ workflow, status }: { workflow: StatusWorkflow; status: string }) {
  const found = statusLabel(workflow, status);
  if (!found) return <span className="badge badge-neutral">{status}</span>;
  return <span className={`badge ${TONE_CLASS[found.tone]}`}>{found.label}</span>;
}
