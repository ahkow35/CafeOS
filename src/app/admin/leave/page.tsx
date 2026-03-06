'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { LeaveRequest, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import DecisionTicket from '@/components/DecisionTicket';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

// Extend the interface to handle the joined profile data
interface LeaveRequestWithProfile extends LeaveRequest {
    profiles: User | null; // Supabase returns this as an object for singular relations
}

export default function AdminLeavePage() {
    const router = useRouter();
    const supabase = createClient();
    const toast = useToast();

    const [currentUser, setCurrentUser] = useState<any>(null);
    const [selectedRequest, setSelectedRequest] = useState<LeaveRequestWithProfile | null>(null);
    const [requests, setRequests] = useState<LeaveRequestWithProfile[]>([]);
    const [localProfile, setLocalProfile] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Derived state
    const isOwner = localProfile?.role === 'owner';
    const isManager = localProfile?.role === 'manager';

    useEffect(() => {
        loadPageData();
    }, []);

    const loadPageData = async () => {
        try {
            setLoading(true);
            setError(null);

            // 1. Check Authentication
            const { data: { user }, error: authError } = await supabase.auth.getUser();

            if (authError || !user) {
                router.push('/login');
                return;
            }
            setCurrentUser(user);

            // 2. Fetch Profile & Leaves in Parallel
            const [profileResult, leavesResult] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', user.id).single(),
                supabase.from('leave_requests').select('*, profiles(*)').order('created_at', { ascending: true })
            ]);

            // 3. Validate Profile
            if (profileResult.error) {
                // If this fails, it's usually RLS permissions
                throw new Error(`Profile Load Failed: ${profileResult.error.message}`);
            }
            const profileData = profileResult.data as User;
            setLocalProfile(profileData);

            // 4. Access Control
            if (profileData.role !== 'manager' && profileData.role !== 'owner') {
                router.push('/'); // Kick non-admins out
                return;
            }

            // 5. Process Leaves
            if (leavesResult.error) {
                throw new Error(`Leaves Load Failed: ${leavesResult.error.message}`);
            }

            const allRequests = leavesResult.data as unknown as LeaveRequestWithProfile[];
            let filteredRequests: LeaveRequestWithProfile[] = [];

            if (profileData.role === 'owner') {
                // Owners see pending_owner AND pending_manager (can handle both)
                // Owners CAN see their own requests (self-approve allowed)
                filteredRequests = allRequests.filter(r =>
                    r.status === 'pending_owner' || r.status === 'pending_manager'
                );
            } else if (profileData.role === 'manager') {
                // Managers only see pending_manager requests
                // EXCLUDE their own requests (cannot self-approve)
                filteredRequests = allRequests.filter(r =>
                    r.status === 'pending_manager' && r.user_id !== user.id
                );
            }

            setRequests(filteredRequests);

        } catch (err: unknown) {
            console.error('Page Load Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
            setError(errorMessage);
        } finally {
            setLoading(false); // Stop the spinner no matter what
        }
    };

    const fetchLeavesOnly = async () => {
        if (!localProfile || !currentUser) return;
        try {
            const { data, error } = await supabase
                .from('leave_requests')
                .select('*, profiles(*)')
                .order('created_at', { ascending: true });

            if (error) throw error;

            const allRequests = data as unknown as LeaveRequestWithProfile[];
            // Re-apply filter (same logic as loadPageData)
            let filtered: LeaveRequestWithProfile[];
            if (localProfile.role === 'owner') {
                // Owners see all pending requests (can self-approve)
                filtered = allRequests.filter(r =>
                    r.status === 'pending_owner' || r.status === 'pending_manager'
                );
            } else {
                // Managers: exclude their own requests
                filtered = allRequests.filter(r =>
                    r.status === 'pending_manager' && r.user_id !== currentUser.id
                );
            }

            setRequests(filtered);
        } catch (err: unknown) {
            console.error(err);
        }
    };

    const handleApprove = async (request: LeaveRequestWithProfile) => {
        if (!currentUser) return;
        setProcessing(request.id);

        try {
            // Optimistic UI Update (Hide card immediately)
            setRequests(prev => prev.filter(r => r.id !== request.id));
            setSelectedRequest(null);

            if (isManager) {
                // MANAGER: Escalate to Owner
                const { error } = await supabase
                    .from('leave_requests')
                    .update({
                        status: 'pending_owner',
                        manager_action_by: currentUser.id,
                        manager_action_at: new Date().toISOString(),
                    })
                    .eq('id', request.id);
                if (error) throw error;
            }
            else if (isOwner) {
                // OWNER: Final Approval & Deduct Balance
                const requestUser = request.profiles;
                if (!requestUser) throw new Error('User profile not found.');

                // Dynamic Key Access Fix
                const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                // Force Type Cast to allow dynamic access
                const currentBalance = (requestUser as any)[balanceField] || 0;
                const newBalance = currentBalance - request.days_requested;

                // 1. Update Status
                const { error: statusError } = await supabase
                    .from('leave_requests')
                    .update({
                        status: 'approved',
                        owner_action_by: currentUser.id,
                        owner_action_at: new Date().toISOString(),
                    })
                    .eq('id', request.id);

                if (statusError) throw statusError;

                // 2. Update Balance
                const { error: balanceError } = await supabase
                    .from('profiles')
                    .update({ [balanceField]: newBalance })
                    .eq('id', request.user_id);

                if (balanceError) toast(`Status updated but balance failed: ${balanceError.message}`, 'error');
            }

            // Sync with server silently
            await fetchLeavesOnly();

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'An error occurred';
            toast(`Error: ${errorMessage}`, 'error');
            await fetchLeavesOnly(); // Revert UI on error
        } finally {
            setProcessing(null);
        }
    };

    const handleReject = async (request: LeaveRequestWithProfile) => {
        if (!currentUser) return;
        setProcessing(request.id);

        try {
            setRequests(prev => prev.filter(r => r.id !== request.id));
            setSelectedRequest(null);

            const updateData = isOwner
                ? { status: 'rejected', owner_action_by: currentUser.id, owner_action_at: new Date().toISOString() }
                : { status: 'rejected', manager_action_by: currentUser.id, manager_action_at: new Date().toISOString() };

            const { error } = await supabase.from('leave_requests').update(updateData).eq('id', request.id);
            if (error) throw error;

            await fetchLeavesOnly();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'An error occurred';
            toast(`Error: ${errorMessage}`, 'error');
            await fetchLeavesOnly();
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
                                const displayName = request.profiles?.full_name || 'Unknown';

                                return (
                                    <div key={request.id} style={{ opacity: processing === request.id ? 0.5 : 1 }}>
                                        {isOwner ? (
                                            <DecisionTicket
                                                request={request}
                                                userName={displayName}
                                                onApprove={() => handleApprove(request)}
                                                onReject={() => handleReject(request)}
                                                processing={processing === request.id}
                                            />
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