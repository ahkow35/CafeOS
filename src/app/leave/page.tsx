'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { LeaveRequest } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import LeaveBalanceCard from '@/components/LeaveBalanceCard';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { Palmtree, BarChart3, Plus, Clock, History, Inbox } from 'lucide-react';

export default function LeavePage() {
    const { user, profile, loading, refreshProfile } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [requestsLoading, setRequestsLoading] = useState(true);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    useEffect(() => {
        if (user) {
            fetchLeaveRequests();
            refreshProfile(); // Refresh profile to get latest leave balance
        }
    }, [user]);

    const fetchLeaveRequests = async () => {
        const { data, error } = await supabase
            .from('leave_requests')
            .select('*')
            .eq('user_id', user?.id)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setRequests(data as LeaveRequest[]);
        }
        setRequestsLoading(false);
    };

    const handleDelete = async (requestId: string) => {
        if (!confirm('Scrap this request?')) return;

        const { error } = await supabase
            .from('leave_requests')
            .delete()
            .eq('id', requestId);

        if (!error) {
            fetchLeaveRequests();
        } else {
            alert('Failed to delete request');
        }
    };

    if (loading || !user || !profile) {
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

                    {/* Leave Balance */}
                    <section className="section animate-in">
                        <h2 className="section-title">
                            <BarChart3 size={20} />
                            <span>Your Balance</span>
                        </h2>
                        <LeaveBalanceCard
                            annualBalance={profile.annual_leave_balance}
                            medicalBalance={profile.medical_leave_balance}
                        />
                    </section>

                    {/* Apply Button */}
                    <section className="section animate-in">
                        <Link href="/leave/apply" className="btn btn-primary btn-block btn-lg">
                            <Plus size={20} />
                            <span>Apply for Leave</span>
                        </Link>
                    </section>

                    {/* Pending Requests */}
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

                    {/* Past Requests */}
                    <section className="section animate-in">
                        <h2 className="section-title">
                            <History size={20} />
                            <span>Request History</span>
                        </h2>

                        {requestsLoading ? (
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
