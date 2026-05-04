'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Home, CheckSquare, Calendar, Settings, Clock } from 'lucide-react';

const ROLE_CACHE_KEY = 'cafeos_role';

export default function BottomNav() {
    const pathname = usePathname();
    const { slug } = useParams<{ slug: string }>();
    const { profile } = useAuth();
    const base = `/c/${slug}`;

    useEffect(() => {
        if (profile?.role) {
            localStorage.setItem(ROLE_CACHE_KEY, profile.role);
        }
    }, [profile?.role]);

    const role = profile?.role ?? (typeof window !== 'undefined' ? localStorage.getItem(ROLE_CACHE_KEY) ?? '' : '');

    const isManagerOrOwner = role === 'manager' || role === 'owner';
    const isPartTimer = role === 'part_timer';

    const navItems = [
        { href: `${base}/admin`, label: 'Home', icon: Home },
        { href: `${base}/tasks`, label: 'Tasks', icon: CheckSquare },
    ];

    if (isPartTimer) {
        navItems.push({ href: `${base}/timesheet`, label: 'Timesheet', icon: Clock });
    } else {
        navItems.push({ href: `${base}/leave`, label: 'Leave', icon: Calendar });
    }

    if (isManagerOrOwner) {
        navItems.push({ href: `${base}/admin`, label: 'Admin', icon: Settings });
    }

    return (
        <nav className="bottom-nav">
            <div className="bottom-nav-content">
                {navItems.map(item => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={`bottom-nav-item ${isActive ? 'active' : ''}`}
                        >
                            <span className="bottom-nav-icon">
                                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                            </span>
                            <span className="bottom-nav-label">{item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
