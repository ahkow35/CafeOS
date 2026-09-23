'use client';

import { useEffect, useRef, useState } from 'react';
import { Coffee } from 'lucide-react';

type Stage = 'form' | 'verify' | 'done' | 'manual-submitted';

interface StartResponse {
  error?: string;
  deepLink?: string;
  signupId?: string;
}

export default function StartPage() {
  const [cafeName, setCafeName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [error, setError] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [loading, setLoading] = useState(false);
  const [deepLink, setDeepLink] = useState('');
  const [signupId, setSignupId] = useState('');
  const pollRef = useRef<number | null>(null);

  // Poll for completion every 3s while waiting on Telegram — the bot's own
  // reply is the primary path (switching apps on a phone often kills this
  // tab), this is the fallback for whoever keeps the tab open.
  useEffect(() => {
    if (stage !== 'verify' || !signupId) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/start/status/${signupId}`);
        const data = (await res.json().catch(() => ({}))) as { status?: string };
        if (data.status === 'completed') {
          setStage('done');
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      } catch {
        // Transient network hiccup — keep polling silently.
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [stage, signupId]);

  async function submit(mode: 'instant' | 'manual') {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, cafeName, ownerName, ownerPhone: '+65' + phone, ownerEmail: ownerEmail || null }),
      });
      const data = (await res.json().catch(() => ({}))) as StartResponse;
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (mode === 'manual') {
        setStage('manual-submitted');
      } else {
        setDeepLink(data.deepLink ?? '');
        setSignupId(data.signupId ?? '');
        setStage('verify');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit('instant');
  };

  if (stage === 'manual-submitted') {
    return (
      <div className="auth-page">
        <div className="auth-card animate-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Application submitted!</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '24px' }}>
            We will review your application and contact you at <strong>+65 {phone}</strong> within 1–2 business days.
          </p>
          <a href="/login" className="btn btn-primary btn-block">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="auth-page">
        <div className="auth-card animate-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Done — check Telegram to set your PIN</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '24px' }}>
            Your café is live. Telegram has a link to set your 6-digit PIN — tap it to finish and sign in.
          </p>
          <a href="/login" className="btn btn-primary btn-block">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  if (stage === 'verify') {
    return (
      <div className="auth-page">
        <div className="auth-card animate-in" style={{ textAlign: 'center' }}>
          <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '16px 0 8px' }}>Verify with Telegram</h2>
          <p className="auth-subtitle" style={{ marginBottom: '24px' }}>
            Tap below to open Telegram, then follow the bot&rsquo;s instructions to share your phone number.
          </p>
          <a href={deepLink} target="_blank" rel="noreferrer" className="btn btn-primary btn-block btn-lg">
            Verify with Telegram
          </a>
          <p className="form-hint" style={{ marginTop: '16px' }}>Waiting for verification…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card animate-in">
        <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
        <p className="auth-subtitle">Set up your café — verified instantly through Telegram.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="cafeName" className="form-label">Cafe name</label>
            <input
              id="cafeName"
              type="text"
              className="form-input"
              placeholder="e.g. Sunrise Coffee"
              value={cafeName}
              onChange={(e) => setCafeName(e.target.value)}
              required
              maxLength={100}
              autoComplete="organization"
            />
          </div>

          <div className="form-group">
            <label htmlFor="ownerName" className="form-label">Your full name</label>
            <input
              id="ownerName"
              type="text"
              className="form-input"
              placeholder="e.g. Sarah Tan"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              maxLength={100}
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone" className="form-label">Your mobile number</label>
            <div style={{ display: 'flex' }}>
              <span
                className="form-input"
                style={{
                  width: 'auto',
                  padding: '0 12px',
                  borderRight: 'none',
                  color: 'var(--color-text-muted)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                +65
              </span>
              <input
                id="phone"
                type="tel"
                className="form-input"
                style={{ borderLeft: 'none', flex: 1 }}
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
            <label htmlFor="ownerEmail" className="form-label">
              Email address
            </label>
            <input
              id="ownerEmail"
              name="ownerEmail"
              type="email"
              autoComplete="email"
              className="form-input"
              placeholder="you@example.com"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
            <p className="form-hint">Used for billing notifications. Optional.</p>
          </div>

          {error && <div className="form-error mb-md">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Starting…' : 'Verify with Telegram'}
          </button>
        </form>

        <div className="auth-footer">
          <button type="button" className="text-button" onClick={() => void submit('manual')} disabled={loading}>
            No Telegram? Ask us to set you up
          </button>
        </div>

        <div className="auth-footer">
          Already have an account? <a href="/login" style={{ color: 'var(--color-primary)' }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
