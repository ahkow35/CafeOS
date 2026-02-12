'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Home, CheckSquare, Calendar, Settings } from 'lucide-react';

export default function BottomNav() {
    const pathname = usePathname();
    const { profile } = useAuth();

    // Show admin tab for managers and owners
    const isManagerOrOwner = profile?.role === 'manager' || profile?.role === 'owner';

    const navItems = [
        { href: '/', label: 'Home', icon: Home },
        { href: '/tasks', label: 'Tasks', icon: CheckSquare },
        { href: '/leave', label: 'Leave', icon: Calendar },
    ];

    if (isManagerOrOwner) {
        navItems.push({ href: '/admin', label: 'Admin', icon: Settings });
    }

    return (
        <nav className="bottom-nav">
            <div className="bottom-nav-content">
                {navItems.map(item => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
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
