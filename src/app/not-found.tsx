'use client';

import Link from 'next/link';
import { Home, FileQuestion } from 'lucide-react';

export default function NotFound() {
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
                    color: 'var(--color-text-muted)'
                }}>
                    <FileQuestion size={64} strokeWidth={1.5} style={{ margin: '0 auto' }} />
                </div>

                <h1 style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '2rem',
                    marginBottom: 'var(--space-sm)',
                    letterSpacing: '0.05em'
                }}>
                    PAGE NOT FOUND
                </h1>

                <p style={{
                    color: 'var(--color-text-muted)',
                    marginBottom: 'var(--space-xl)',
                    lineHeight: 1.6
                }}>
                    Oops! The page you're looking for doesn't exist. It might have been moved or deleted.
                </p>

                <Link href="/" className="btn btn-primary" style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)'
                }}>
                    <Home size={18} />
                    <span>Back to Home</span>
                </Link>
            </div>
        </div>
    );
}
