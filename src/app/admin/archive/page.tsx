'use client';

import { createClient } from '@/lib/supabase';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Calendar, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import { LeaveRequest, User } from '@/lib/database.types';

interface LeaveWithProfile extends LeaveRequest {
    profiles: User | null;
}

export default function AdminArchivePage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [leaves, setLeaves] = useState<LeaveWithProfile[]>([]);
    const [loadingData, setLoadingData] = useState(true);
    const [filter, setFilter] = useState<'all' | 'approved' | 'rejected'>('all');

    useEffect(() => {
        if (!loading && !user) router.push('/login');
        // Allow both manager and owner to access
        if (!loading && profile && profile.role !== 'owner' && profile.role !== 'manager') {
            router.push('/admin');
        }
    }, [user, profile, loading, router]);

    useEffect(() => {
        if (profile && (profile.role === 'owner' || profile.role === 'manager')) {
            fetchLeaveHistory();
        }
    }, [profile?.role]);

    const fetchLeaveHistory = async () => {
        setLoadingData(true);
        try {
            let query = supabase
                .from('leave_requests')
                .select('*, profiles(*)')
                .in('status', ['approved', 'rejected'])
                .order('created_at', { ascending: false });

            const { data, error } = await query;

            if (error) {
                console.error('Error fetching leave history:', error);
            } else {
                let results = (data || []) as LeaveWithProfile[];

                // Manager can only see staff leave records (not manager/owner)
                // Owner can see all records
                if (profile?.role === 'manager') {
                    results = results.filter(leave =>
                        leave.profiles?.role === 'staff'
                    );
                }

                setLeaves(results);
            }
        } catch (err) {
            console.error('Unexpected error:', err);
        } finally {
            setLoadingData(false);
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

    if (loading || !profile || (profile.role !== 'owner' && profile.role !== 'manager')) {
        return <div className="loading"><div className="spinner" /></div>;
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">📋 LEAVE ARCHIVE</h1>
                        <p className="page-subtitle">Historical Leave Records</p>
                    </section>

                    {/* Filter Tabs */}
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
                                                {leave.profiles?.full_name || 'Unknown User'}
                                            </div>
                                            <div className="card-subtitle" style={{ fontSize: '0.75rem' }}>
                                                {leave.profiles?.role} • {leave.leave_type === 'annual' ? '🏖️ Annual' : '🏥 Medical'}
                                            </div>
                                        </div>
                                        {getStatusBadge(leave.status)}
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
                        onClick={() => router.push('/admin')}
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
