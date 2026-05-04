'use client';

import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Calendar, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useEffect, useState, useCallback } from 'react';
import { LeaveRequest, User } from '@/lib/database.types';

type ProfileMini = Pick<User, 'full_name' | 'phone_e164' | 'role' | 'annual_leave_balance' | 'medical_leave_balance'>;

interface LeaveWithProfile extends LeaveRequest {
    profile: ProfileMini | null;
}

async function jsonOrError(res: Response): Promise<unknown> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return res.json();
}

export default function AdminArchivePage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [leaves, setLeaves] = useState<LeaveWithProfile[]>([]);
    const [loadingData, setLoadingData] = useState(true);
    const [filter, setFilter] = useState<'all' | 'approved' | 'rejected'>('all');
    const isOwner = profile?.role === 'owner';
    const isAdmin = profile?.role === 'manager' || profile?.role === 'owner';

    const fetchLeaveHistory = useCallback(async () => {
        setLoadingData(true);
        try {
            const data = await jsonOrError(await fetch('/api/leave-requests?scope=history')) as
                { requests: LeaveWithProfile[] };
            setLeaves(data.requests ?? []);
        } catch (err: unknown) {
            toast(`Failed to load history: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setLoadingData(false);
        }
    }, [toast]);

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isAdmin) { router.push(`/c/${slug}/admin`); return; }
        if (isAdmin) fetchLeaveHistory();
    }, [user, profile, loading, isAdmin, fetchLeaveHistory, router]);

    const handleDelete = async (leaveId: string) => {
        if (!confirm('Permanently delete this leave record? This cannot be undone.')) return;

        const previous = leaves;
        setLeaves(prev => prev.filter(l => l.id !== leaveId));

        try {
            await jsonOrError(await fetch(`/api/leave-requests/${leaveId}`, { method: 'DELETE' }));
        } catch (err: unknown) {
            toast(`Failed to delete record: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
            setLeaves(previous);
        }
    };

    const filteredLeaves = filter === 'all'
        ? leaves
        : leaves.filter(l => l.status === filter);

    const getStatusBadge = (status: string) => {
        if (status === 'approved') {
            return (
                <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    backgroundColor: '#dcfce7',
                    color: '#16a34a'
                }}>
                    <CheckCircle size={12} />
                    APPROVED
                </span>
            );
        }
        return (
            <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                backgroundColor: '#fee2e2',
                color: '#dc2626'
            }}>
                <XCircle size={12} />
                REJECTED
            </span>
        );
    };

    if (loading || !profile || !isAdmin) {
        return <div className="loading"><div className="spinner" /></div>;
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">LEAVE ARCHIVE</h1>
                        <p className="page-subtitle">Historical Leave Records</p>
                    </section>

                    <div className="animate-in" style={{
                        display: 'flex',
                        gap: 'var(--space-sm)',
                        marginBottom: 'var(--space-md)',
                        borderBottom: '2px solid var(--color-concrete)',
                        paddingBottom: 'var(--space-sm)'
                    }}>
                        {(['all', 'approved', 'rejected'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                                style={{ textTransform: 'capitalize' }}
                            >
                                {f === 'all' ? `All (${leaves.length})` :
                                    f === 'approved' ? `Approved (${leaves.filter(l => l.status === 'approved').length})` :
                                        `Rejected (${leaves.filter(l => l.status === 'rejected').length})`}
                            </button>
                        ))}
                    </div>

                    {loadingData ? (
                        <div className="loading"><div className="spinner" /></div>
                    ) : filteredLeaves.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon">
                                <Calendar size={48} />
                            </div>
                            <div className="empty-state-title">No Records Found</div>
                            <p>No {filter !== 'all' ? filter : ''} leave history yet.</p>
                        </div>
                    ) : (
                        <div className="animate-in">
                            {filteredLeaves.map(leave => (
                                <div key={leave.id} className="card" style={{ marginBottom: 'var(--space-md)' }}>
                                    <div className="card-header" style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}>
                                        <div>
                                            <div className="card-title" style={{
                                                fontFamily: 'var(--font-heading)',
                                                textTransform: 'uppercase'
                                            }}>
                                                {leave.profile?.full_name || 'Unknown User'}
                                            </div>
                                            <div className="card-subtitle" style={{ fontSize: '0.75rem' }}>
                                                {leave.profile?.role} • {leave.leave_type === 'annual' ? 'Annual' : 'Medical'}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {getStatusBadge(leave.status)}
                                            {isOwner && (
                                                <button
                                                    onClick={() => handleDelete(leave.id)}
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--color-danger)', padding: '4px 8px' }}
                                                    title="Delete record"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: 'var(--space-md)',
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                        gap: 'var(--space-sm)',
                                        borderTop: '1px solid var(--color-concrete)'
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                                Dates
                                            </div>
                                            <div style={{ fontWeight: 'bold' }}>
                                                {new Date(leave.start_date).toLocaleDateString()} - {new Date(leave.end_date).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                                Days
                                            </div>
                                            <div style={{ fontWeight: 'bold' }}>
                                                {leave.days_requested} day{leave.days_requested !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                                Applied On
                                            </div>
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {new Date(leave.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                                                Decided On
                                            </div>
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {leave.owner_action_at
                                                    ? new Date(leave.owner_action_at).toLocaleDateString()
                                                    : leave.manager_action_at
                                                        ? new Date(leave.manager_action_at).toLocaleDateString()
                                                        : '-'}
                                            </div>
                                        </div>
                                    </div>

                                    {leave.reason && (
                                        <div style={{
                                            padding: 'var(--space-sm) var(--space-md)',
                                            borderTop: '1px solid var(--color-concrete)',
                                            fontSize: '0.85rem',
                                            color: 'var(--color-text-muted)'
                                        }}>
                                            <strong>Reason:</strong> {leave.reason}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push(`/c/${slug}/admin`)}
                    >
                        <ArrowLeft size={18} />
                        <span>Back to Command Center</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
