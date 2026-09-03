'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { LeaveRequest } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import LeaveBalanceCard from '@/components/LeaveBalanceCard';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import TelegramLinkButton from '@/components/TelegramLinkButton';
import { BarChart3, Plus, Clock, History, Inbox, Receipt } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

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

export default function LeavePage() {
    const { user, profile, loading, refreshProfile } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [requestsLoading, setRequestsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    const fetchLeaveRequests = useCallback(async () => {
        setFetchError(null);
        try {
            const data = await jsonOrError(await fetch('/api/leave-requests?scope=mine')) as { requests: LeaveRequest[] };
            setRequests(data.requests ?? []);
        } catch (err) {
            console.error('Failed to load leave requests:', err);
            setFetchError('Failed to load your leave requests. Please try again.');
        } finally {
            setRequestsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchLeaveRequests();
    }, [user, fetchLeaveRequests]);

    const handleDelete = async (requestId: string) => {
        const requestToCancel = requests.find(r => r.id === requestId);
        if (!requestToCancel) return;

        const daysToRestore = requestToCancel.days_requested;
        const leaveType = requestToCancel.leave_type;

        if (!confirm(
            `Cancel this leave request? Your ${daysToRestore} day${daysToRestore !== 1 ? 's' : ''} will be returned to your ${leaveType} leave balance.`
        )) return;

        try {
            await jsonOrError(await fetch(`/api/leave-requests/${requestId}`, { method: 'DELETE' }));
            await refreshProfile();
            await fetchLeaveRequests();
        } catch (err) {
            console.error('Failed to cancel request:', err);
            toast(err instanceof Error ? err.message : 'Failed to cancel request. Please try again.', 'error');
        }
    };

    if (loading || !user) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const pendingRequests = requests.filter(r => r.status === 'pending_manager' || r.status === 'pending_owner');
    const pastRequests = requests.filter(r => r.status === 'approved' || r.status === 'rejected');

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Leave Management</h1>
                        <p className="page-subtitle">Track your time off</p>
                    </section>

                    <section className="section animate-in">
                        <h2 className="section-title">
                            <BarChart3 size={20} />
                            <span>Your Balance</span>
                        </h2>
                        <LeaveBalanceCard
                            annualBalance={profile?.annual_leave_balance ?? 0}
                            medicalBalance={profile?.medical_leave_balance ?? 0}
                        />
                    </section>

                    <section className="section animate-in">
                        <Link href={`/c/${slug}/leave/apply`} className="btn btn-primary btn-block btn-lg">
                            <Plus size={20} />
                            <span>Apply for Leave</span>
                        </Link>
                    </section>

                    <section className="section animate-in">
                        <Link href={`/c/${slug}/claims`} className="btn btn-secondary btn-block">
                            <Receipt size={20} />
                            <span>Medical Claims</span>
                        </Link>
                    </section>

                    <section className="section animate-in">
                        <TelegramLinkButton isLinked={Boolean(profile?.telegram_chat_id)} />
                    </section>

                    {pendingRequests.length > 0 && (
                        <section className="section animate-in">
                            <h2 className="section-title">
                                <Clock size={20} />
                                <span>Pending Requests</span>
                            </h2>
                            {pendingRequests.map(request => (
                                <LeaveRequestCard
                                    key={request.id}
                                    request={request}
                                    onCancel={() => handleDelete(request.id)}
                                />
                            ))}
                        </section>
                    )}

                    <section className="section animate-in">
                        <h2 className="section-title">
                            <History size={20} />
                            <span>Request History</span>
                        </h2>

                        {fetchError ? (
                            <div className="empty-state">
                                <div className="empty-state-title" style={{ color: '#ef4444' }}>Failed to load requests</div>
                                <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                                <button className="btn btn-primary" onClick={fetchLeaveRequests}>Try again</button>
                            </div>
                        ) : requestsLoading ? (
                            <div className="loading">
                                <div className="spinner" />
                            </div>
                        ) : pastRequests.length > 0 ? (
                            pastRequests.map(request => (
                                <LeaveRequestCard key={request.id} request={request} />
                            ))
                        ) : pendingRequests.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">
                                    <Inbox size={48} />
                                </div>
                                <div className="empty-state-title">No requests yet</div>
                                <p>Apply for leave to get started</p>
                            </div>
                        ) : null}
                    </section>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
