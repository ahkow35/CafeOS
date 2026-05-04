'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Cafe {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  approved_at: string | null;
}

interface Member {
  user_id: string;
  full_name: string;
  phone_e164: string;
  role: string;
  status: string;
  is_active: boolean;
}

export default function CafeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [cafe, setCafe] = useState<Cafe | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvedPin, setApprovedPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/super/cafes/${id}`)
      .then((r) => r.json() as Promise<{ cafe?: Cafe; members?: Member[]; error?: string }>)
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setCafe(d.cafe ?? null);
        setMembers(d.members ?? []);
      })
      .catch(() => setError('Failed to load cafe'))
      .finally(() => setLoading(false));
  }, [id]);

  const post = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) { setActionError(String(data.error ?? 'Action failed')); return null; }
      return data;
    } catch {
      setActionError('Network error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    const data = await post(`/api/super/cafes/${id}/approve`);
    if (data) {
      setApprovedPin(String(data.pin));
      setCafe((c) => c ? { ...c, status: 'active' } : c);
    }
  };

  const handleSuspend = async () => {
    if (!confirm(`Suspend ${cafe?.name}? All logged-in sessions will be cut off on next request.`)) return;
    const data = await post(`/api/super/cafes/${id}/suspend`);
    if (data) setCafe((c) => c ? { ...c, status: 'suspended' } : c);
  };

  const handleImpersonate = async (userId: string) => {
    const data = await post(`/api/super/cafes/${id}/impersonate`, { userId });
    if (data?.redirect) router.push(String(data.redirect));
  };

  if (loading) return <div style={{ padding: '32px', color: 'var(--color-text-muted)' }}>Loading…</div>;
  if (error) return <div style={{ padding: '32px' }}><div className="form-error">{error}</div></div>;
  if (!cafe) return null;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/super" style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>← Back to cafes</Link>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700 }}>{cafe.name}</h1>
            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              /{cafe.slug} · Status: <b>{cafe.status}</b>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {cafe.status === 'pending' && (
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={busy}
              >
                {busy ? 'Approving…' : 'Approve'}
              </button>
            )}
            {cafe.status === 'active' && (
              <button
                className="btn"
                style={{ background: 'var(--color-error)', color: '#fff' }}
                onClick={handleSuspend}
                disabled={busy}
              >
                {busy ? 'Suspending…' : 'Suspend'}
              </button>
            )}
            {cafe.status === 'suspended' && (
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>Cafe is suspended</span>
            )}
          </div>
        </div>

        {actionError && <div className="form-error mb-md">{actionError}</div>}

        {approvedPin && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '16px', marginTop: '12px' }}>
            <p style={{ fontWeight: 600, marginBottom: '4px' }}>Cafe approved!</p>
            <p style={{ fontSize: '13px', color: '#166534' }}>
              Owner&apos;s one-time PIN: <code style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '0.1em' }}>{approvedPin}</code>
            </p>
            <p style={{ fontSize: '12px', color: '#166534', marginTop: '4px' }}>
              Deliver this PIN to the owner via Telegram or phone. It will not be shown again.
            </p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        Members ({members.length})
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {members.map((m) => (
          <div
            key={m.user_id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{m.full_name}</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                {m.phone_e164} · {m.role} · membership: {m.status}
                {!m.is_active && ' · profile inactive'}
              </div>
            </div>
            {cafe.status === 'active' && m.status === 'active' && (
              <button
                className="btn"
                style={{ fontSize: '13px', padding: '6px 12px' }}
                onClick={() => handleImpersonate(m.user_id)}
                disabled={busy}
              >
                View as
              </button>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>No members yet.</p>
        )}
      </div>
    </div>
  );
}
