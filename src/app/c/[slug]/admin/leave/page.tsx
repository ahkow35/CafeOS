'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { LeaveRequest, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import DecisionTicket from '@/components/DecisionTicket';
import { CheckCircle, ArrowLeft, Trash2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

type ProfileMini = Pick<
    User,
    'full_name' | 'phone_e164' | 'role' | 'annual_leave_balance' | 'medical_leave_balance'
>;

interface LeaveRequestWithProfile extends LeaveRequest {
    profile: ProfileMini | null;
    profiles?: ProfileMini | null; // legacy compat for child components still expecting this shape
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

export default function AdminLeavePage() {
    const router = useRouter();
    const toast = useToast();
    const { user, profile, loading: authLoading } = useAuth();

    const [requests, setRequests] = useState<LeaveRequestWithProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const isOwner = profile?.role === 'owner';
    const isAdmin = profile?.role === 'manager' || profile?.role === 'owner';

    const fetchPending = useCallback(async () => {
        const data = await jsonOrError(await fetch('/api/leave-requests?scope=pending')) as
            { requests: LeaveRequestWithProfile[] };
        // Mirror profile → profiles for any child components still reading the old key.
        const normalised = data.requests.map(r => ({ ...r, profiles: r.profile }));
        setRequests(normalised);
    }, []);

    const loadPageData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            await fetchPending();
        } catch (err: unknown) {
            console.error('Page Load Error:', err);
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [fetchPending]);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isAdmin) { router.push('/'); return; }
        if (isAdmin) loadPageData();
    }, [user, profile, authLoading, isAdmin, loadPageData, router]);

    const handleApprove = async (request: LeaveRequestWithProfile) => {
        setProcessing(request.id);
        setRequests(prev => prev.filter(r => r.id !== request.id));
        try {
            await jsonOrError(await fetch(`/api/leave-requests/${request.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve' }),
            }));
            await fetchPending();
        } catch (err: unknown) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
            await fetchPending();
        } finally {
            setProcessing(null);
        }
    };

    const handleReject = async (request: LeaveRequestWithProfile) => {
        setProcessing(request.id);
        setRequests(prev => prev.filter(r => r.id !== request.id));
        try {
            await jsonOrError(await fetch(`/api/leave-requests/${request.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject' }),
            }));
            await fetchPending();
        } catch (err: unknown) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
            await fetchPending();
        } finally {
            setProcessing(null);
        }
    };

    const handleDelete = async (request: LeaveRequestWithProfile) => {
        const ownerName = request.profile?.full_name || 'the employee';
        const confirmMessage = `Delete this pending request? ${request.days_requested} day${request.days_requested !== 1 ? 's' : ''} will be returned to ${ownerName}'s ${request.leave_type} leave balance.`;
        if (!confirm(confirmMessage)) return;

        setProcessing(request.id);
        setRequests(prev => prev.filter(r => r.id !== request.id));
        try {
            await jsonOrError(await fetch(`/api/leave-requests/${request.id}`, { method: 'DELETE' }));
            await fetchPending();
        } catch (err: unknown) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
            await fetchPending();
        } finally {
            setProcessing(null);
        }
    };

    const pageTitle = isOwner ? 'DECISION DESK' : 'Leave Requests';
    const pageSubtitle = isOwner ? 'Final Approval Queue' : 'Review & Escalate';

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">{pageTitle}</h1>
                        <p className="page-subtitle">{pageSubtitle}</p>
                    </section>

                    {error && (
                        <div style={{
                            backgroundColor: '#fee2e2',
                            border: '1px solid #ef4444',
                            color: '#b91c1c',
                            padding: '1rem',
                            borderRadius: 'var(--border-radius)',
                            marginBottom: '1rem'
                        }}>
                            <strong>Error:</strong> {error}
                            <button
                                onClick={loadPageData}
                                style={{
                                    marginLeft: '1rem',
                                    textDecoration: 'underline',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'inherit',
                                    fontWeight: 'bold'
                                }}
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div className="loading">
                            <div className="spinner" />
                        </div>
                    ) : requests.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon">
                                <CheckCircle size={48} />
                            </div>
                            <div className="empty-state-title">All caught up!</div>
                            <p>No pending leave requests for your review</p>
                        </div>
                    ) : (
                        <section className="section animate-in">
                            {requests.map(request => {
                                const displayName = request.profile?.full_name || 'Unknown';

                                return (
                                    <div key={request.id} style={{ opacity: processing === request.id ? 0.5 : 1 }}>
                                        {isOwner ? (
                                            <>
                                                <DecisionTicket
                                                    request={request}
                                                    userName={displayName}
                                                    onApprove={() => handleApprove(request)}
                                                    onReject={() => handleReject(request)}
                                                    processing={processing === request.id}
                                                />
                                                <button
                                                    onClick={() => handleDelete(request)}
                                                    className="btn btn-ghost btn-sm btn-block"
                                                    style={{
                                                        color: 'var(--color-danger)',
                                                        marginTop: '-0.75rem',
                                                        marginBottom: 'var(--spacing-lg)',
                                                        fontSize: '0.8rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '0.4rem',
                                                    }}
                                                    disabled={!!processing}
                                                >
                                                    <Trash2 size={14} />
                                                    <span>Delete Record</span>
                                                </button>
                                            </>
                                        ) : (
                                            <LeaveRequestCard
                                                request={request}
                                                userName={displayName}
                                                showActions={true}
                                                onApprove={() => handleApprove(request)}
                                                onReject={() => handleReject(request)}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </section>
                    )}

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push('/admin')}
                    >
                        <ArrowLeft size={18} />
                        <span>Back to Admin</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
