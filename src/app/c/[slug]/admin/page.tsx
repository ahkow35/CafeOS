'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Settings, BarChart3, Calendar, ClipboardList, CheckSquare, Users, ChevronRight, Clock, CreditCard, Receipt } from 'lucide-react';

interface AdminStats {
    pendingManagerLeave: number;
    pendingOwnerLeave: number;
    pendingTasks: number;
    staffCount: number;
    pendingClaims: number;
}

export default function AdminPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const base = `/c/${slug}`;

    const [stats, setStats] = useState<AdminStats>({
        pendingManagerLeave: 0,
        pendingOwnerLeave: 0,
        pendingTasks: 0,
        staffCount: 0,
        pendingClaims: 0,
    });
    const [statsLoading, setStatsLoading] = useState(true);

    const isOwner = profile?.role === 'owner';
    const isManager = profile?.role === 'manager';
    const isManagerOrOwner = isManager || isOwner;

    const pageLoading = loading || (isManagerOrOwner && statsLoading);

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isManagerOrOwner) { router.push(`${base}/leave`); return; }
    }, [user, profile, loading, router, isManagerOrOwner]);

    useEffect(() => {
        if (!isManagerOrOwner) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/stats');
                if (!res.ok) throw new Error(`Stats failed (${res.status})`);
                const data = await res.json() as { stats: AdminStats };
                if (!cancelled) setStats(data.stats);
            } catch (err) {
                console.error('Failed to load admin stats:', err);
            } finally {
                if (!cancelled) setStatsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isManagerOrOwner]);

    if (pageLoading || !user || !profile || !isManagerOrOwner) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    // Owners can act on BOTH stages (the Decision Desk shows pending_manager + pending_owner),
    // so the Overview count must include both — otherwise staff requests sitting at
    // pending_manager (e.g. no manager to escalate) show as 0 on the owner's dashboard.
    const pendingLeaveCount = isOwner
        ? stats.pendingOwnerLeave + stats.pendingManagerLeave
        : stats.pendingManagerLeave;
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

                            <Link href={`${base}/admin/leave`} className="card mb-md" style={{ display: 'block', textDecoration: 'none', border: '2px solid var(--color-primary)' }}>
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

                            <Link href={`${base}/admin/claims`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon"><Receipt size={28} /></div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">MEDICAL CLAIMS</div>
                                        <div className="card-subtitle">
                                            {stats.pendingClaims > 0 ? `${stats.pendingClaims} awaiting your decision` : 'Approve receipts against staff caps'}
                                        </div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href={`${base}/admin/staff`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <Users size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">STAFF MANAGEMENT</div>
                                        <div className="card-subtitle">Roles, balances & hourly rates</div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>

                            <Link href={`${base}/admin/archive`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
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

                            <Link href={`${base}/admin/timesheets`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
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

                            <Link href={`${base}/billing`} className="card" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon">
                                        <CreditCard size={28} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">BILLING</div>
                                        <div className="card-subtitle">Manage subscription & payment</div>
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
                            <>
                                <Link href={`${base}/admin/leave`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
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

                                <Link href={`${base}/admin/claims`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                    <div className="flex items-center gap-md">
                                        <div className="stat-icon"><Receipt size={28} /></div>
                                        <div style={{ flex: 1 }}>
                                            <div className="card-title">MEDICAL CLAIMS</div>
                                            <div className="card-subtitle">View pending claims (owner approves)</div>
                                        </div>
                                        <ChevronRight size={20} className="text-muted" />
                                    </div>
                                </Link>
                            </>
                        )}

                        <Link href={`${base}/admin/tasks`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
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

                        {/* Archive + Timesheets links for managers (owners have them in Command Center) */}
                        {!isOwner && (
                            <>
                                <Link href={`${base}/admin/timesheets`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                    <div className="flex items-center gap-md">
                                        <div className="stat-icon">
                                            <Clock size={28} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div className="card-title">Timesheets</div>
                                            <div className="card-subtitle">Part-timer timesheet approval</div>
                                        </div>
                                        <ChevronRight size={20} className="text-muted" />
                                    </div>
                                </Link>
                                <Link href={`${base}/admin/archive`} className="card" style={{ display: 'block', textDecoration: 'none' }}>
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
                            </>
                        )}
                    </section>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
