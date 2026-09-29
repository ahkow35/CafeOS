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
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  subscription_status: string | null;
}

function billingBadgeVariant(status: string | null): string {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'success';
    case 'past_due':
      return 'warning';
    case 'canceled':
    case 'unpaid':
    case 'paused':
    case 'incomplete_expired':
      return 'error';
    default:
      return 'neutral';
  }
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

  const handleReject = async () => {
    if (!confirm(`Reject and delete "${cafe?.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/super/cafes/${id}/reject`, { method: 'DELETE' });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) { setActionError(String(data.error ?? 'Action failed')); return; }
      router.push('/super');
    } catch {
      setActionError('Network error');
    } finally {
      setBusy(false);
    }
  };

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

      <div style={{ background: 'var(--color-surface)', border: 'var(--border-width-thin) solid var(--color-border)', borderRadius: 'var(--radius-12)', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 'var(--font-weight-heading)' }}>{cafe.name}</h1>
            <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              /{cafe.slug} · Status: <b>{cafe.status}</b>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {cafe.status === 'pending' && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={handleApprove}
                  disabled={busy}
                >
                  {busy ? 'Approving…' : 'Approve'}
                </button>
                <button
                  className="btn"
                  style={{ background: 'var(--color-error)', color: 'var(--color-white)' }}
                  onClick={handleReject}
                  disabled={busy}
                >
                  Reject
                </button>
              </>
            )}
            {cafe.status === 'active' && (
              <button
                className="btn"
                style={{ background: 'var(--color-error)', color: 'var(--color-white)' }}
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
          <div style={{ background: 'var(--color-status-success-bg-light)', border: 'var(--border-width-thin) solid var(--color-status-success-border)', borderRadius: 'var(--radius-8)', padding: '16px', marginTop: '12px' }}>
            <p style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: '4px' }}>Cafe approved!</p>
            <p style={{ fontSize: '13px', color: 'var(--color-status-success-text)' }}>
              Owner&apos;s one-time PIN: <code style={{ fontSize: '18px', fontWeight: 'var(--font-weight-heading)', letterSpacing: 'var(--letter-spacing-heading)' }}>{approvedPin}</code>
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-status-success-text)', marginTop: '4px' }}>
              Deliver this PIN to the owner via Telegram or phone. It will not be shown again.
            </p>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '14px', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)', letterSpacing: 'var(--letter-spacing-label)', marginBottom: '12px' }}>
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
              border: 'var(--border-width-thin) solid var(--color-border)',
              borderRadius: 'var(--radius-10)',
            }}
          >
            <div>
              <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>{m.full_name}</div>
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

      <div style={{ background: 'var(--color-surface)', border: 'var(--border-width-thin) solid var(--color-border)', borderRadius: 'var(--radius-12)', padding: '20px', marginTop: '24px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)', letterSpacing: 'var(--letter-spacing-label)', marginBottom: '12px' }}>
          Billing
        </h2>
        {cafe.stripe_customer_id ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Subscription status</span>
              <span style={{
                padding: '2px 8px',
                borderRadius: 'var(--radius-pill-lg)',
                fontSize: '12px',
                fontWeight: 'var(--font-weight-semibold)',
                background: billingBadgeVariant(cafe.subscription_status) === 'success' ? 'var(--color-status-success-bg)' :
                            billingBadgeVariant(cafe.subscription_status) === 'warning' ? 'var(--color-status-warning-bg-light)' :
                            billingBadgeVariant(cafe.subscription_status) === 'error' ? 'var(--color-status-danger-bg)' : 'var(--color-concrete)',
                color: billingBadgeVariant(cafe.subscription_status) === 'success' ? 'var(--color-status-success-text)' :
                       billingBadgeVariant(cafe.subscription_status) === 'warning' ? 'var(--color-status-warning-text)' :
                       billingBadgeVariant(cafe.subscription_status) === 'error' ? 'var(--color-status-danger-deep)' : 'var(--color-status-neutral-text)',
              }}>
                {cafe.subscription_status ?? 'unknown'}
              </span>
            </div>
            {cafe.trial_ends_at && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Trial ends</span>
                <span>{new Date(cafe.trial_ends_at).toLocaleDateString('en-SG', { dateStyle: 'medium' })}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Stripe customer</span>
              <a
                href={`https://dashboard.stripe.com/customers/${cafe.stripe_customer_id}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
              >
                {cafe.stripe_customer_id}
              </a>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>No Stripe billing account linked to this cafe.</p>
        )}
      </div>
    </div>
  );
}
