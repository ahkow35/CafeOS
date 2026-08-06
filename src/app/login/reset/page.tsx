'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Coffee, KeyRound, ShieldCheck } from 'lucide-react';

type Stage = 'request' | 'verify' | 'done';

async function responseJson(res: Response): Promise<{ error?: string; message?: string }> {
  return (await res.json().catch(() => ({}))) as { error?: string; message?: string };
}

export default function ResetPinPage() {
  const [stage, setStage] = useState<Stage>('request');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setMessage('');

    if (!/^\d{8}$/.test(phone)) {
      setError('Enter your 8-digit Singapore mobile number.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/pin-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+65${phone}` }),
      });
      const data = await responseJson(res);
      if (!res.ok) {
        setError(data.error ?? 'Could not send a verification code. Please try again.');
        return;
      }
      setMessage(data.message ?? 'If the account can recover by Telegram, a code is on its way.');
      setStage('verify');
      setResendIn(60);
    } catch {
      setError('CafeOS could not be reached. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function resetPin(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPin !== confirmPin) {
      setError('The new PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/pin-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+65${phone}`, code, newPin }),
      });
      const data = await responseJson(res);
      if (!res.ok) {
        setError(data.error ?? 'Could not reset your PIN. Please try again.');
        return;
      }
      setStage('done');
    } catch {
      setError('CafeOS could not be reached. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card animate-in">
        <Link href="/login" className="auth-logo auth-logo-link" aria-label="Back to CafeOS sign in">
          <Coffee size={28} /> CafeOS
        </Link>

        {stage === 'request' && (
          <>
            <div className="auth-icon" aria-hidden="true"><KeyRound size={26} /></div>
            <h1 className="auth-step-title">Reset your PIN</h1>
            <p className="auth-subtitle">We’ll verify it’s you through your linked private Telegram chat.</p>

            <form onSubmit={requestCode}>
              <div className="form-group">
                <label htmlFor="reset-phone" className="form-label">Mobile number</label>
                <div className="phone-field">
                  <span className="phone-prefix" aria-hidden="true">+65</span>
                  <input
                    id="reset-phone"
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

              <div className="security-note">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>For privacy, we won’t confirm whether an account exists. If Telegram isn’t linked, ask your cafe owner to reset your PIN.</p>
              </div>

              {error && <div className="form-error form-message mb-md" role="alert">{error}</div>}

              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
                {loading ? 'Sending…' : 'Send verification code'}
              </button>
            </form>
            <div className="auth-footer"><Link href="/login">Back to sign in</Link></div>
          </>
        )}

        {stage === 'verify' && (
          <>
            <div className="auth-icon" aria-hidden="true"><ShieldCheck size={26} /></div>
            <h1 className="auth-step-title">Check Telegram</h1>
            <p className="auth-subtitle">Enter the code sent for +65 {phone.slice(0, 4)} {phone.slice(4)}.</p>

            {message && <div className="form-message form-message-info mb-md" role="status">{message}</div>}

            <form onSubmit={resetPin}>
              <div className="form-group">
                <label htmlFor="reset-code" className="form-label">6-digit verification code</label>
                <input
                  id="reset-code"
                  type="text"
                  className="form-input pin-input"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                />
              </div>
              <div className="form-group">
                <label htmlFor="new-pin" className="form-label">New 6-digit PIN</label>
                <input
                  id="new-pin"
                  type="password"
                  className="form-input pin-input"
                  placeholder="••••••"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="new-password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  aria-describedby="pin-guidance"
                />
                <p id="pin-guidance" className="form-hint">Avoid repeated digits, number sequences, and the end of your mobile number.</p>
              </div>
              <div className="form-group">
                <label htmlFor="confirm-pin" className="form-label">Confirm new PIN</label>
                <input
                  id="confirm-pin"
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
                {loading ? 'Resetting…' : 'Reset PIN'}
              </button>
            </form>

            <div className="auth-footer auth-footer-stack">
              <button type="button" className="text-button" onClick={() => requestCode()} disabled={loading || resendIn > 0}>
                {resendIn > 0 ? `Request another code in ${resendIn}s` : 'Request another code'}
              </button>
              <button type="button" className="text-button" onClick={() => { setStage('request'); setError(''); setMessage(''); }}>
                Use a different mobile number
              </button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <div className="auth-success" role="status">
            <CheckCircle2 size={44} aria-hidden="true" />
            <h1 className="auth-step-title">PIN reset</h1>
            <p>Your new PIN is ready. For your security, any other CafeOS sessions have been signed out.</p>
            <Link href="/login" className="btn btn-primary btn-block btn-lg">Sign in with new PIN</Link>
          </div>
        )}
      </div>
    </div>
  );
}
