'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Coffee } from 'lucide-react';

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

    const { error } = await signIn('+65' + phone, pin);

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card animate-in">
        <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
        <p className="auth-subtitle">Welcome back! Sign in to continue.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="phone" className="form-label">
              Mobile number
            </label>
            <div style={{ display: 'flex' }}>
              <span className="form-input" style={{ width: 'auto', padding: '0 12px', borderRight: 'none', color: 'var(--color-text-muted)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
            />
          </div>

          {error && (
            <div className="form-error mb-md">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="auth-footer">
          Forgot your PIN? Ask your manager to reset it.
        </div>
      </div>
    </div>
  );
}
