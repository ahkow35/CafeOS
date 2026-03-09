'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { Coffee, Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const { resetPassword } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const { error } = await resetPassword(email);

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            setSent(true);
        }
    };

    if (sent) {
        return (
            <div className="auth-page">
                <div className="auth-card animate-in">
                    <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                    <div className="text-center">
                        <div style={{ marginBottom: '1rem' }}><Mail size={64} /></div>
                        <h2 style={{ marginBottom: '0.5rem' }}>Check your email</h2>
                        <p className="text-muted" style={{ marginBottom: '1.5rem' }}>
                            If an account exists for <strong>{email}</strong>, a password reset link has been sent. Check your inbox.
                        </p>
                        <Link href="/login" className="btn btn-primary btn-block btn-lg">
                            Back to Login
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-card animate-in">
                <h1 className="auth-logo"><Coffee size={28} /> CafeOS</h1>
                <p className="auth-subtitle">Enter your email and we'll send you a reset link.</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="email" className="form-label">
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            className="form-input"
                            placeholder="you@cafe.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            autoFocus
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
                        {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                </form>

                <div className="auth-footer">
                    Remember your password?{' '}
                    <Link href="/login">Sign in</Link>
                </div>
            </div>
        </div>
    );
}
