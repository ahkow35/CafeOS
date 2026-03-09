'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Coffee, CheckCircle, AlertTriangle } from 'lucide-react';

type PageState = 'verifying' | 'ready' | 'invalid' | 'success';

function ResetPasswordForm() {
    const [pageState, setPageState] = useState<PageState>('verifying');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const { updatePassword } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const code = searchParams.get('code');

        if (!code) {
            setPageState('invalid');
            return;
        }

        // Exchange the one-time code from the email link for a session
        const supabase = createClient();
        supabase.auth.exchangeCodeForSession(code)
            .then(({ error }) => {
                if (error) {
                    console.error('Code exchange failed:', error.message);
                    setPageState('invalid');
                } else {
                    setPageState('ready');
                }
            });
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);

        const { error } = await updatePassword(password);

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            setPageState('success');
            setTimeout(() => router.push('/login'), 2000);
        }
    };

    // Verifying — exchanging the code
    if (pageState === 'verifying') {
        return (
            <div className="auth-page">
                <div className="auth-card animate-in">
                    <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                    <div className="loading" style={{ padding: '2rem 0' }}>
                        <div className="spinner" />
                    </div>
                    <p className="text-muted text-center">Verifying your reset link...</p>
                </div>
            </div>
        );
    }

    // Invalid / expired link
    if (pageState === 'invalid') {
        return (
            <div className="auth-page">
                <div className="auth-card animate-in">
                    <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                    <div className="text-center">
                        <div style={{ marginBottom: '1rem', color: 'var(--color-orange)' }}>
                            <AlertTriangle size={64} />
                        </div>
                        <h2 style={{ marginBottom: '0.5rem' }}>Link expired</h2>
                        <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
                            This reset link is invalid or has already been used. Please request a new one.
                        </p>
                        <Link href="/forgot-password" className="btn btn-primary btn-block btn-lg">
                            Request New Link
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    // Success
    if (pageState === 'success') {
        return (
            <div className="auth-page">
                <div className="auth-card animate-in">
                    <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                    <div className="text-center">
                        <div style={{ marginBottom: '1rem', color: 'var(--color-stali-green)' }}>
                            <CheckCircle size={64} />
                        </div>
                        <h2 style={{ marginBottom: '0.5rem' }}>Password updated!</h2>
                        <p className="text-muted">Redirecting you to login...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Ready — show the new password form
    return (
        <div className="auth-page">
            <div className="auth-card animate-in">
                <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                <p className="auth-subtitle">Choose a new password for your account.</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="password" className="form-label">
                            New Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            autoFocus
                        />
                        <div className="form-hint">At least 6 characters</div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="confirmPassword" className="form-label">
                            Confirm New Password
                        </label>
                        <input
                            id="confirmPassword"
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            autoComplete="new-password"
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
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
            </div>
        </div>
    );
}

// Wrap in Suspense because useSearchParams() requires it in Next.js App Router
export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="auth-page">
                <div className="auth-card">
                    <div className="loading" style={{ padding: '2rem 0' }}>
                        <div className="spinner" />
                    </div>
                </div>
            </div>
        }>
            <ResetPasswordForm />
        </Suspense>
    );
}
