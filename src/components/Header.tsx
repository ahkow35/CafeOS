'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { Coffee, LogOut } from 'lucide-react';

export default function Header() {
    const { profile, signOut } = useAuth();

    const getInitials = (name: string | undefined | null) => {
        if (!name) return '?';
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <header className="header">
            <div className="header-content">
                <Link href="/" className="header-logo" style={{ textDecoration: 'none' }}>
                    <Coffee size={24} />
                    <span>CafeOS</span>
                </Link>

                {profile && (
                    <div className="header-user">
                        <button
                            onClick={signOut}
                            className="btn btn-ghost btn-sm"
                            title="Sign Out"
                        >
                            <LogOut size={18} />
                            <span>Sign Out</span>
                        </button>
                        <div className="header-avatar">
                            {getInitials(profile.full_name || profile.email)}
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}
