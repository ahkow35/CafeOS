'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Cafe {
  id: string;
  slug: string;
  name: string;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
  member_count: number;
  owner_name: string | null;
  owner_phone: string | null;
}

const STATUS_LABEL: Record<Cafe['status'], string> = {
  pending: '⏳ Pending',
  active: '✅ Active',
  suspended: '🚫 Suspended',
};

export default function SuperPage() {
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/super/cafes')
      .then((r) => r.json() as Promise<{ cafes?: Cafe[]; error?: string }>)
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setCafes(d.cafes ?? []);
      })
      .catch(() => setError('Failed to load cafes'))
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const pending = cafes.filter((c) => c.status === 'pending');
  const active = cafes.filter((c) => c.status === 'active');
  const suspended = cafes.filter((c) => c.status === 'suspended');

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Super Admin — Cafes</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Link href="/super/admins" style={{ color: 'var(--color-primary)', fontSize: '14px' }}>
            Manage admins
          </Link>
          <button
            type="button"
            onClick={signOut}
            style={{ color: 'var(--color-text-muted)', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Sign out
          </button>
        </div>
      </div>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
      {error && <div className="form-error mb-md">{error}</div>}

      {!loading && !error && (
        <>
          <CafeSection title={`Pending approval (${pending.length})`} cafes={pending} />
          <CafeSection title={`Active cafes (${active.length})`} cafes={active} />
          <CafeSection title={`Suspended (${suspended.length})`} cafes={suspended} />
        </>
      )}
    </div>
  );
}

function CafeSection({ title, cafes }: { title: string; cafes: Cafe[] }) {
  if (cafes.length === 0) return null;
  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {cafes.map((cafe) => (
          <Link
            key={cafe.id}
            href={`/super/cafes/${cafe.id}`}
            style={{
              display: 'block',
              padding: '14px 16px',
              background: 'var(--color-surface)',
              borderRadius: '10px',
              border: '1px solid var(--color-border)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>{cafe.name}</div>
                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                  /{cafe.slug} · {cafe.member_count} member{cafe.member_count !== 1 ? 's' : ''}
                </div>
                {cafe.owner_name && (
                  <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                    Owner: {cafe.owner_name} ({cafe.owner_phone})
                  </div>
                )}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', marginLeft: '12px' }}>
                {STATUS_LABEL[cafe.status]}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
