'use client';

import Link from 'next/link';

interface LeaveBalanceCardProps {
    annualBalance: number;
    medicalBalance: number;
}

export default function LeaveBalanceCard({ annualBalance, medicalBalance }: LeaveBalanceCardProps) {
    return (
        <div className="stats-grid">
            <Link href="/leave/apply?type=annual" style={{ textDecoration: 'none' }}>
                <div className="stat-card" style={{ cursor: 'pointer' }}>
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
                        Annual Leave
                    </div>
                    <div className="stat-value" style={{
                        background: 'var(--color-black)',
                        color: 'var(--color-neon)',
                        fontSize: '3rem',
                        padding: '1rem',
                        display: 'inline-block',
                        width: '100%',
                        fontFamily: 'var(--font-heading)'
                    }}>
                        {annualBalance}
                    </div>
                </div>
            </Link>
            <Link href="/leave/apply?type=medical" style={{ textDecoration: 'none' }}>
                <div className="stat-card" style={{ cursor: 'pointer' }}>
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
                        Medical Leave
                    </div>
                    <div className="stat-value" style={{
                        background: 'var(--color-black)',
                        color: 'var(--color-white)',
                        fontSize: '3rem',
                        padding: '1rem',
                        display: 'inline-block',
                        width: '100%',
                        fontFamily: 'var(--font-heading)'
                    }}>
                        {medicalBalance}
                    </div>
                </div>
            </Link>
        </div>
    );
}
