'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Coffee, KeyRound } from 'lucide-react';

interface SetPinResponse {
  error?: string;
  redirect?: string;
}

function SetPinForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="auth-card animate-in" style={{ textAlign: 'center' }}>
        <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
        <h2 className="auth-step-title">Missing link</h2>
        <p className="auth-subtitle">
          This page needs the link Telegram sent you. Send <code>/pin</code> to the bot for a fresh one.
        </p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (pin !== confirmPin) {
      setError('The two PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/start/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin, confirmPin }),
      });
      const data = (await res.json().catch(() => ({}))) as SetPinResponse;
      if (!res.ok) {
        setError(data.error ?? 'Could not set your PIN. Please try again.');
        return;
      }
      router.replace(data.redirect ?? '/login');
    } catch {
      setError('CafeOS could not be reached. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-card animate-in">
      <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
      <div className="auth-icon" aria-hidden="true"><KeyRound size={26} /></div>
      <h2 className="auth-step-title">Set your PIN</h2>
      <p className="auth-subtitle">Choose a 6-digit PIN to finish setting up your café.</p>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="pin" className="form-label">6-digit PIN</label>
          <input
            id="pin"
            type="password"
            className="form-input pin-input"
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            autoComplete="new-password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
          />
        </div>
        <div className="form-group">
          <label htmlFor="confirmPin" className="form-label">Confirm PIN</label>
          <input
            id="confirmPin"
            type="password"
            className="form-input pin-input"
            placeholder="••••••"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            autoComplete="new-password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
          />
        </div>

        {error && <div className="form-error form-message mb-md" role="alert">{error}</div>}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
          {loading ? 'Setting PIN…' : 'Set PIN & continue'}
        </button>
      </form>
    </div>
  );
}

export default function SetPinPage() {
  return (
    <div className="auth-page">
      <Suspense fallback={<div className="auth-card animate-in" />}>
        <SetPinForm />
      </Suspense>
    </div>
  );
}
