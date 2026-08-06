'use client';

import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Coffee, LogOut } from 'lucide-react';

export default function Header() {
    const { profile, signOut } = useAuth();
    const { slug } = useParams<{ slug: string }>();
    const router = useRouter();
    const [signingOut, setSigningOut] = useState(false);

    const getInitials = (name: string | undefined | null) => {
        if (!name) return '?';
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const homeHref = profile?.role === 'manager' || profile?.role === 'owner'
        ? `/c/${slug}/admin`
        : profile?.role === 'part_timer'
        ? `/c/${slug}/timesheet`
        : `/c/${slug}/tasks`;

    const handleSignOut = async () => {
        setSigningOut(true);
        await signOut();
        router.replace('/login');
        router.refresh();
    };

    return (
        <header className="header">
            <div className="header-content">
                <Link href={homeHref} className="header-logo" style={{ textDecoration: 'none' }}>
                    <Coffee size={24} />
                    <span>CafeOS</span>
                </Link>

                {profile && (
                    <div className="header-user">
                        <button
                            onClick={handleSignOut}
                            className="btn btn-ghost btn-sm"
                            title="Sign Out"
                            disabled={signingOut}
                        >
                            <LogOut size={18} />
                            <span className="header-action-label">{signingOut ? 'Signing Out' : 'Sign Out'}</span>
                        </button>
                        <Link
                            href={`/c/${slug}/account`}
                            className="header-avatar"
                            aria-label="Open account and security settings"
                            title="Account & security"
                        >
                            {getInitials(profile.full_name || profile.email)}
                        </Link>
                    </div>
                )}
            </div>
        </header>
    );
}
