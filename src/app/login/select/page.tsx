'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Coffee, ChevronRight, Shield } from 'lucide-react';

interface CafeInfo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

interface MembershipInfo {
  cafe: CafeInfo;
  role: string;
}

function readFromStorage(): { memberships: MembershipInfo[]; isSuperAdmin: boolean } {
  if (typeof window === 'undefined') return { memberships: [], isSuperAdmin: false };
  try {
    const raw = sessionStorage.getItem('cafeos_pick_memberships');
    const sa = sessionStorage.getItem('cafeos_pick_super');
    if (!raw) return { memberships: [], isSuperAdmin: false };
    return { memberships: JSON.parse(raw) as MembershipInfo[], isSuperAdmin: sa === 'true' };
  } catch {
    return { memberships: [], isSuperAdmin: false };
  }
}

export default function SelectCafePage() {
  const router = useRouter();
  const [memberships] = useState<MembershipInfo[]>(() => readFromStorage().memberships);
  const [isSuperAdmin] = useState<boolean>(() => readFromStorage().isSuperAdmin);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If nothing was stored, redirect back to login.
    if (memberships.length === 0 && !isSuperAdmin) {
      router.replace('/login');
    }
  }, [memberships.length, isSuperAdmin, router]);

  async function selectCafe(cafeId: string) {
    setSelecting(cafeId);
    setError(null);
    try {
      const res = await fetch('/api/auth/select-cafe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafeId }),
      });
      const json = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Selection failed');
        setSelecting(null);
        return;
      }
      sessionStorage.removeItem('cafeos_pick_memberships');
      sessionStorage.removeItem('cafeos_pick_super');
      router.push(json.redirect ?? '/');
    } catch {
      setError('Network error — please try again');
      setSelecting(null);
    }
  }

  async function goSuper() {
    setSelecting('super');
    setError(null);
    try {
      const res = await fetch('/api/auth/select-cafe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goSuper: true }),
      });
      const json = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Selection failed');
        setSelecting(null);
        return;
      }
      sessionStorage.removeItem('cafeos_pick_memberships');
      sessionStorage.removeItem('cafeos_pick_super');
      router.push(json.redirect ?? '/super');
    } catch {
      setError('Network error — please try again');
      setSelecting(null);
    }
  }

  if (memberships.length === 0 && !isSuperAdmin) {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Coffee size={40} style={{ margin: '0 auto 0.75rem' }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Choose a workspace</h1>
          <p style={{ color: 'var(--color-muted)', marginTop: '0.5rem' }}>
            You have access to multiple cafes. Select one to continue.
          </p>
        </div>

        {error && (
          <div className="toast toast-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {memberships.map((m) => (
            <button
              key={m.cafe.id}
              onClick={() => selectCafe(m.cafe.id)}
              disabled={selecting !== null}
              className="card"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', opacity: selecting && selecting !== m.cafe.id ? 0.5 : 1 }}
            >
              <div className="flex items-center gap-md">
                {m.cafe.logo_url ? (
                  <Image src={m.cafe.logo_url} alt={m.cafe.name} width={40} height={40} style={{ borderRadius: '8px', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Coffee size={20} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{m.cafe.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', textTransform: 'capitalize' }}>{m.role}</div>
                </div>
                {selecting === m.cafe.id ? (
                  <div className="spinner" style={{ width: 18, height: 18 }} />
                ) : (
                  <ChevronRight size={18} style={{ color: 'var(--color-muted)' }} />
                )}
              </div>
            </button>
          ))}

          {isSuperAdmin && (
            <button
              onClick={goSuper}
              disabled={selecting !== null}
              className="card"
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--color-primary)', opacity: selecting && selecting !== 'super' ? 0.5 : 1 }}
            >
              <div className="flex items-center gap-md">
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shield size={20} style={{ color: '#fff' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>Super Admin Dashboard</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Platform management</div>
                </div>
                {selecting === 'super' ? (
                  <div className="spinner" style={{ width: 18, height: 18 }} />
                ) : (
                  <ChevronRight size={18} style={{ color: 'var(--color-muted)' }} />
                )}
              </div>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
