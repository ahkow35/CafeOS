'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Settings, BarChart3, Calendar, ClipboardList, CheckSquare, Users, ChevronRight, Clock } from 'lucide-react';

export default function AdminPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [stats, setStats] = useState({
        pendingManagerLeave: 0,
        pendingOwnerLeave: 0,
        pendingTasks: 0,
        staffCount: 0,
    });
    const [statsLoading, setStatsLoading] = useState(true);

    const isOwner = profile?.role === 'owner';
    const isManager = profile?.role === 'manager';
    const isManagerOrOwner = isManager || isOwner;

    // Use auth loading correctly
    const pageLoading = loading || (isManagerOrOwner && statsLoading);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        } else if (!loading && profile && !isManagerOrOwner) {
            router.push('/');
        }
    }, [user, profile, loading, router, isManagerOrOwner]);

    useEffect(() => {
        if (isManagerOrOwner) {
            fetchStats();
        }
    }, [profile, isManagerOrOwner]);

    const fetchStats = async () => {
        const [
            { count: managerLeaveCount },
            { count: ownerLeaveCount },
            { count: taskCount },
            { count: staffCount },
        ] = await Promise.all([
            supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending_manager'),
            supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending_owner'),
            supabase
                .from('tasks')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending'),
            supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('role', 'staff'),
        ]);

        setStats({
            pendingManagerLeave: managerLeaveCount ?? 0,
            pendingOwnerLeave: ownerLeaveCount ?? 0,
            pendingTasks: taskCount ?? 0,
            staffCount: staffCount ?? 0,
        });
        setStatsLoading(false);
    };

    if (pageLoading || !user || !profile || !isManagerOrOwner) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const pendingLeaveCount = isOwner ? stats.pendingOwnerLeave : stats.pendingManagerLeave;
    const leaveSubtitle = isOwner
        ? 'Final approval for leave requests'
        : 'Review and escalate to owner';

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">{isOwner ? 'Owner' : 'Manager'} Dashboard</h1>
                        <p className="page-subtitle">Manage your cafe operations</p>
                    </section>

                    {/* Quick Stats */}
                    <section className="section animate-in">
                        <h2 className="section-title">
                            <BarChart3 size={20} />
                            <span>Overview</span>
                        </h2>
                        {statsLoading ? (
                            <div className="loading">
                                <div className="spinner" />
                            </div>
                        ) : (
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-icon">
                                        <Calendar size={24} />
                                    </div>
                                    <div className={`stat-value ${pendingLeaveCount > 0 ? 'warning' : 'success'}`}>
                                        {pendingLeaveCount}
                                    </div>
                                    <div className="stat-label">Pending Leave</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon">
                                        <CheckSquare size={24} />
                                    </div>
                                    <div className="stat-value">{stats.pendingTasks}</div>
                                    <div className="stat-label">Active Tasks</div>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Owner Command Center */}
                    {isOwner && (
                        <section className="section animate-in">
                            <h2 className="section-title">
                                <span style={{ fontSize: '1.5rem' }}>⚡</span>
                                <span>Command Center</span>
                            </h2>

                            <Link href="/admin/leave" className="card mb-md" style={{ display: 'block', textDecoration: 'none', border: '2px solid var(--color-primary)' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <ClipboardList size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">DECISION DESK</div>
                                        <div className="card-subtitle">Approve/Reject Pending Requests</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href="/admin/manifest" className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <Users size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">LEAVE CONTROL</div>
                                        <div className="card-subtitle">Strict Balance Control</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href="/admin/team" className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <Users size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">MANAGE TEAM</div>
                                        <div className="card-subtitle">Roles & Permissions</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href="/admin/archive" className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <CheckSquare size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">ARCHIVE</div>
                                        <div className="card-subtitle">Read-Only History</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href="/admin/timesheets" className="card" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <Clock size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">TIMESHEETS</div>
                                        <div className="card-subtitle">Part-timer timesheet approval</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>
                        </section>
                    )}

                    {/* Standard Actions */}
                    <section className="section animate-in">
                        <h2 className="section-title">
                            <Settings size={20} />
                            <span>General Actions</span>
                        </h2>

                        {!isOwner && (
                            <Link href="/admin/leave" className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <ClipboardList size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">Review Leave Requests</div>
                                        <div className="card-subtitle">{leaveSubtitle}</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>
                        )}

                        <Link href="/admin/tasks" className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                            <div className="flex items-center gap-md">
                                <div className="stat-icon">
                                    <CheckSquare size={28} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div className="card-title">Manage Tasks</div>
                                    <div className="card-subtitle">Create and assign tasks to staff</div>
                                </div>
                                <ChevronRight size={20} className="text-muted" />
                            </div>
                        </Link>

                        {/* Archive link for managers (owners have it in Command Center) */}
                        {!isOwner && (
                            <Link href="/admin/archive" className="card" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <Calendar size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">Leave Archive</div>
                                        <div className="card-subtitle">View leave history records</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>
                        )}
                    </section>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
