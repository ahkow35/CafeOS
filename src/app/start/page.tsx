'use client';

import { useState } from 'react';
import { Coffee } from 'lucide-react';

export default function StartPage() {
  const [cafeName, setCafeName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafeName, ownerName, ownerPhone: '+65' + phone, ownerEmail: ownerEmail || null }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
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

  return (
    <div className="auth-page">
      <div className="auth-card animate-in">
        <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
        <p className="auth-subtitle">Apply for access for your cafe.</p>

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
            {loading ? 'Submitting...' : 'Apply for access'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <a href="/login" style={{ color: 'var(--color-primary)' }}>Sign in</a>
        </div>
      </div>
    </div>
  );
}
