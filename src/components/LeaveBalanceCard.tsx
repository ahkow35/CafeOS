'use client';

import Link from 'next/link';
import { Palmtree, Stethoscope } from 'lucide-react';

interface LeaveBalanceCardProps {
    annualBalance: number;
    medicalBalance: number;
}

export default function LeaveBalanceCard({ annualBalance, medicalBalance }: LeaveBalanceCardProps) {
    const getBalanceStatus = (balance: number) => {
        if (balance <= 2) return 'danger';
        if (balance <= 5) return 'warning';
        return 'success';
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.transform = 'scale(1.02)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = 'none';
    };

    return (
        <div className="stats-grid">
            <Link
                href="/leave/apply?type=annual"
                style={{ textDecoration: 'none' }}
            >
                <div
                    className="stat-card"
                    style={{
                        border: '2px solid black',
                        padding: '1rem',
                        cursor: 'pointer',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    }}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>Annual Leave</div>
                    <div className="stat-value" style={{
                        background: 'black',
                        color: '#CCFF00',
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
            <Link
                href="/leave/apply?type=medical"
                style={{ textDecoration: 'none' }}
            >
                <div
                    className="stat-card"
                    style={{
                        border: '2px solid black',
                        padding: '1rem',
                        cursor: 'pointer',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    }}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>Medical Leave</div>
                    <div className={`stat-value`} style={{
                        background: 'black',
                        color: 'white',
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
