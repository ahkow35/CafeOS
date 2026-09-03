'use client';

import { formatSGD } from '@/lib/money';

interface ClaimBalanceCardProps {
    available: number;   // membership balance (what approval can draw on)
    pending: number;     // sum of the caller's pending claims
}

export default function ClaimBalanceCard({ available, pending }: ClaimBalanceCardProps) {
    const remaining = Math.max(0, available - pending);
    return (
        <div className="stat-card">
            <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                Medical Claim Balance
            </div>
            <div className="stat-value" style={{
                background: 'var(--color-black)',
                color: 'var(--color-neon)',
                fontSize: '2.25rem',
                padding: '1rem',
                width: '100%',
                fontFamily: 'var(--font-heading)',
            }}>
                {formatSGD(remaining)}
            </div>
            {pending > 0 && (
                <div className="text-muted mt-sm" style={{ fontSize: '0.8rem' }}>
                    {formatSGD(pending)} pending approval · {formatSGD(available)} on account
                </div>
            )}
        </div>
    );
}
