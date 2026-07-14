'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function BillingPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const { user, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Billing is owner-only. Mirror the API gate client-side so non-owners never
  // see the page (the API enforces it regardless).
  const isOwner = profile?.role === 'owner';
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    if (profile && !isOwner) router.push(`/c/${slug}/admin`);
  }, [authLoading, user, profile, isOwner, router, slug]);

  if (authLoading || !profile || !isOwner) return null;

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to open billing portal');
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-container">
      <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
        <h1 className="page-title">Billing</h1>
        <p className="text-secondary" style={{ marginBottom: '1.5rem' }}>
          Manage your CafeOS subscription — update your payment method, view invoices, or cancel.
        </p>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        <button className="btn btn-primary" onClick={openPortal} disabled={loading}>
          {loading ? 'Opening…' : 'Manage Billing'}
        </button>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: '0.75rem' }}
          onClick={() => router.back()}
        >
          Back
        </button>
      </div>
    </main>
  );
}
