'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

interface Admin {
  id: string;
  full_name: string;
  phone_e164: string;
  is_active: boolean;
  created_at: string;
}

export default function SuperAdminsPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAdmins = () => {
    setLoading(true);
    fetch('/api/super/admins')
      .then((r) => r.json() as Promise<{ admins?: Admin[]; error?: string }>)
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setAdmins(d.admins ?? []);
      })
      .catch(() => setError('Failed to load admins'))
      .finally(() => setLoading(false));
  };

  useEffect(loadAdmins, []);

  const toggle = async (admin: Admin) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/super/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: admin.id, grant: false }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setActionError(data.error ?? 'Failed'); return; }
      loadAdmins();
    } catch {
      setActionError('Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/super" style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>← Back to cafes</Link>
      </div>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px' }}>Super Admins</h1>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
      {error && <div className="form-error mb-md">{error}</div>}
      {actionError && <div className="form-error mb-md">{actionError}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {admins.map((a) => (
          <div
            key={a.id}
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
              <div style={{ fontWeight: 600 }}>{a.full_name} {a.id === user?.id ? '(you)' : ''}</div>
              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{a.phone_e164}</div>
            </div>
            {a.id !== user?.id && (
              <button
                className="btn"
                style={{ fontSize: '13px', padding: '6px 12px', background: 'var(--color-error)', color: '#fff' }}
                onClick={() => toggle(a)}
                disabled={busy}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
        {!loading && admins.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>No super admins found.</p>
        )}
      </div>

      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '16px' }}>
        To grant super admin access, run <code>db/bootstrap-super-admin.sql</code> with the target phone number.
      </p>
    </div>
  );
}
