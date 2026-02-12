'use client';

import { useEffect } from 'react';
import { Home, RefreshCw, AlertTriangle } from 'lucide-react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to error reporting service
        console.error('Application error:', error);
    }, [error]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg)',
            padding: 'var(--space-lg)'
        }}>
            <div style={{
                textAlign: 'center',
                maxWidth: '500px'
            }}>
                <div style={{
                    marginBottom: 'var(--space-lg)',
                    color: 'var(--color-danger)'
                }}>
                    <AlertTriangle size={64} strokeWidth={1.5} style={{ margin: '0 auto' }} />
                </div>

                <h1 style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '2rem',
                    marginBottom: 'var(--space-sm)',
                    letterSpacing: '0.05em'
                }}>
                    SOMETHING WENT WRONG
                </h1>

                <p style={{
                    color: 'var(--color-text-muted)',
                    marginBottom: 'var(--space-xl)',
                    lineHeight: 1.6
                }}>
                    We encountered an unexpected error. Please try again or return to the home page.
                </p>

                <div style={{
                    display: 'flex',
                    gap: 'var(--space-sm)',
                    justifyContent: 'center',
                    flexWrap: 'wrap'
                }}>
                    <button
                        onClick={reset}
                        className="btn btn-primary"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-xs)'
                        }}
                    >
                        <RefreshCw size={18} />
                        <span>Try Again</span>
                    </button>

                    <a
                        href="/"
                        className="btn btn-ghost"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-xs)'
                        }}
                    >
                        <Home size={18} />
                        <span>Back to Home</span>
                    </a>
                </div>
            </div>
        </div>
    );
}
