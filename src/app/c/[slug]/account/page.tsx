'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, KeyRound, ShieldCheck, Smartphone, UserRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TelegramLinkButton from '@/components/TelegramLinkButton';

export default function AccountPage() {
  const { profile, loading } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);

  async function changePin(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPin !== confirmPin) {
      setError('The new PINs do not match.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not update your PIN. Please try again.');
        return;
      }
      setChanged(true);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch {
      setError('CafeOS could not be reached. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !profile) {
    return <div className="loading" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <section className="page-header animate-in">
            <h1 className="page-title">Account & Security</h1>
            <p className="page-subtitle">Your identity, alerts, and sign-in PIN</p>
          </section>

          <section className="section animate-in">
            <h2 className="section-title"><UserRound size={20} /><span>Your account</span></h2>
            <div className="card account-card">
              <div className="account-avatar" aria-hidden="true">
                {profile.full_name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="account-identity">
                <strong>{profile.full_name}</strong>
                <span>{profile.job_title || profile.role?.replace('_', ' ') || 'CafeOS user'}</span>
              </div>
              <div className="account-detail">
                <Smartphone size={17} aria-hidden="true" />
                <span>{profile.phone_e164.replace('+65', '+65 ')}</span>
              </div>
            </div>
          </section>

          <section className="section animate-in">
            <h2 className="section-title"><KeyRound size={20} /><span>Sign-in PIN</span></h2>
            <div className="card security-card">
              {changed ? (
                <div className="security-success" role="status">
                  <CheckCircle2 size={38} aria-hidden="true" />
                  <div>
                    <h3>PIN updated</h3>
                    <p>All CafeOS sessions were signed out to protect your account.</p>
                  </div>
                  <Link href="/login" className="btn btn-primary btn-block">Sign in again</Link>
                </div>
              ) : (
                <form onSubmit={changePin}>
                  <p className="security-intro">Enter your current PIN before choosing a new one.</p>
                  <div className="form-group">
                    <label htmlFor="current-pin" className="form-label">Current PIN</label>
                    <input
                      id="current-pin"
                      type="password"
                      className="form-input pin-input"
                      value={currentPin}
                      onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      inputMode="numeric"
                      autoComplete="current-password"
                      pattern="\d{6}"
                      maxLength={6}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="account-new-pin" className="form-label">New PIN</label>
                    <input
                      id="account-new-pin"
                      type="password"
                      className="form-input pin-input"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      inputMode="numeric"
                      autoComplete="new-password"
                      pattern="\d{6}"
                      maxLength={6}
                      aria-describedby="account-pin-hint"
                    />
                    <p id="account-pin-hint" className="form-hint">Use six hard-to-guess digits—no repeats, sequences, or mobile-number ending.</p>
                  </div>
                  <div className="form-group">
                    <label htmlFor="account-confirm-pin" className="form-label">Confirm new PIN</label>
                    <input
                      id="account-confirm-pin"
                      type="password"
                      className="form-input pin-input"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      inputMode="numeric"
                      autoComplete="new-password"
                      pattern="\d{6}"
                      maxLength={6}
                    />
                  </div>

                  <div className="security-note mb-md">
                    <ShieldCheck size={18} aria-hidden="true" />
                    <p>Changing your PIN signs out every device using your account.</p>
                  </div>
                  {error && <div className="form-error form-message mb-md" role="alert">{error}</div>}
                  <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
                    {saving ? 'Updating…' : 'Update PIN'}
                  </button>
                </form>
              )}
            </div>
          </section>

          <section className="section animate-in">
            <h2 className="section-title"><ShieldCheck size={20} /><span>Recovery & alerts</span></h2>
            <TelegramLinkButton isLinked={Boolean(profile.telegram_chat_id)} />
            <p className="section-footnote">
              A linked private Telegram chat lets CafeOS send alerts and securely verify you if you forget your PIN.
            </p>
          </section>

          <div className="auth-footer"><Link href={`/c/${slug}/`}>Back to your workspace</Link></div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
