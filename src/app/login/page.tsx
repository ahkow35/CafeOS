'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { KeyRound } from 'lucide-react';
import Image from 'next/image';

const NOTICE_TEXT: Record<string, string> = {
  'cafe-suspended': "This café's account is suspended, so it can't be opened right now. Please speak to your café owner.",
  'cafe-pending': 'This café is still waiting for approval. Please try again once it has been approved.',
};

/** Why the visitor was sent back here, when the cafe layout said so. Any other value shows nothing. */
function LoginNotice() {
  const notice = useSearchParams().get('notice') ?? '';
  if (!Object.prototype.hasOwnProperty.call(NOTICE_TEXT, notice)) return null;
  return (
    <div className="form-message form-message-info mb-md" role="status">
      {NOTICE_TEXT[notice]}
    </div>
  );
}

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error, outcome } = await signIn('+65' + phone, pin);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (outcome?.kind === 'pick') {
      // Multiple cafes — store data for the picker page and navigate there.
      sessionStorage.setItem('cafeos_pick_memberships', JSON.stringify(outcome.memberships));
      sessionStorage.setItem('cafeos_pick_super', String(outcome.isSuperAdmin));
      router.replace('/login/select');
      return;
    }

    // Single destination — session cookie already set.
    // Invalidate RSC prefetched while unauthenticated before navigating.
    router.refresh();
    router.replace((outcome as { kind: 'redirect'; to: string } | undefined)?.to ?? '/');
  };

  return (
    <div className="auth-page">
      <div className="auth-card animate-in">
        <h1 className="auth-logo"><Image src="/logo.svg" alt="" width={28} height={28} unoptimized /> CafeOS</h1>
        <p className="auth-subtitle">Sign in to your café.</p>

        {/* Reads the address on the client, so the page itself stays prerendered. */}
        <Suspense fallback={null}>
          <LoginNotice />
        </Suspense>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="phone" className="form-label">
              Mobile number
            </label>
            <div className="phone-field">
              <span className="phone-prefix" aria-hidden="true">
                +65
              </span>
              <input
                id="phone"
                type="tel"
                className="form-input"
                placeholder="91234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 8))}
                required
                autoComplete="tel"
                inputMode="numeric"
                maxLength={8}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="pin" className="form-label">
              6-digit PIN
            </label>
            <input
              id="pin"
              type="password"
              className="form-input"
              placeholder="••••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoComplete="current-password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
            />
          </div>

          {error && (
            <div className="form-error form-message mb-md" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <Link href="/login/reset" className="auth-recovery-link">
          <KeyRound size={16} />
          Forgot your PIN?
        </Link>
        <div className="auth-footer" style={{ marginTop: '8px' }}>
          New café? <Link href="/start">Start a free trial</Link>
        </div>
      </div>
    </div>
  );
}
