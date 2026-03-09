'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { LeaveRequest, User } from '@/lib/database.types';
import { Check, X, Loader2 } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface LeaveRequestWithUser extends LeaveRequest {
    requester?: User;
}

interface PendingApprovalsWidgetProps {
    userRole: 'manager' | 'owner';
    userId: string;
}

export default function PendingApprovalsWidget({ userRole, userId }: PendingApprovalsWidgetProps) {
    const supabase = createClient();
    const toast = useToast();
    const [pendingRequests, setPendingRequests] = useState<LeaveRequestWithUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    useEffect(() => {
        loadPendingRequests();
    }, [userRole]);

    const loadPendingRequests = async () => {
        setLoading(true);

        // Managers see pending_manager, Owners see pending_owner
        const statusFilter = userRole === 'manager' ? 'pending_manager' : 'pending_owner';

        const { data, error } = await supabase
            .from('leave_requests')
            .select(`
                *,
                requester:profiles(*)
            `)
            .eq('status', statusFilter)
            .order('created_at', { ascending: true })
            .limit(3);

        if (error) {
            console.error('Error loading pending requests:', error);
        } else {
            setPendingRequests((data as LeaveRequestWithUser[]) || []);
        }

        setLoading(false);
    };

    const handleApprove = async (request: LeaveRequestWithUser) => {
        setActionLoading(request.id);

        try {
            // Determine next status
            let newStatus: LeaveRequest['status'] = 'approved';
            const updateData: Partial<LeaveRequest> = {
                updated_at: new Date().toISOString(),
            };

            if (userRole === 'manager') {
                // Manager approves → goes to pending_owner
                newStatus = 'pending_owner';
                updateData.status = newStatus;
                updateData.manager_action_by = userId;
                updateData.manager_action_at = new Date().toISOString();
            } else {
                // Owner approves → final approval
                newStatus = 'approved';
                updateData.status = newStatus;
                updateData.owner_action_by = userId;
                updateData.owner_action_at = new Date().toISOString();
            }

            // Update leave request
            const { error: updateError } = await supabase
                .from('leave_requests')
                .update(updateData)
                .eq('id', request.id);

            if (updateError) throw updateError;

            // If owner approves, deduct balance
            if (userRole === 'owner') {
                const balanceField = request.leave_type === 'annual'
                    ? 'annual_leave_balance'
                    : 'medical_leave_balance';

                const currentBalance = request.leave_type === 'annual'
                    ? request.requester?.annual_leave_balance ?? 0
                    : request.requester?.medical_leave_balance ?? 0;

                await supabase
                    .from('profiles')
                    .update({
                        [balanceField]: currentBalance - request.days_requested
                    })
                    .eq('id', request.user_id);
            }

            // Refresh list
            await loadPendingRequests();
        } catch (error: unknown) {
            console.error('Error approving request:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast(`Failed to approve: ${errorMessage}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };

    const handleReject = async (request: LeaveRequestWithUser) => {
        if (!confirm(`Are you sure you want to reject this ${request.leave_type} leave request?`)) {
            return;
        }

        setActionLoading(request.id);
        try {
            const updateData: Partial<LeaveRequest> = {
                status: 'rejected',
                updated_at: new Date().toISOString(),
            };

            if (userRole === 'manager') {
                updateData.manager_action_by = userId;
                updateData.manager_action_at = new Date().toISOString();
            } else {
                updateData.owner_action_by = userId;
                updateData.owner_action_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('leave_requests')
                .update(updateData)
                .eq('id', request.id);

            if (error) throw error;

            // Restore the employee's balance (was deducted at submission time)
            if (request.requester) {
                const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                const currentBalance = request.leave_type === 'annual'
                    ? request.requester.annual_leave_balance ?? 0
                    : request.requester.medical_leave_balance ?? 0;

                await supabase
                    .from('profiles')
                    .update({ [balanceField]: currentBalance + request.days_requested })
                    .eq('id', request.user_id);
            }

            // Refresh list
            await loadPendingRequests();
        } catch (error: unknown) {
            console.error('Error rejecting request:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            toast(`Failed to reject: ${errorMessage}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                <Loader2 size={24} className="spinner" style={{ margin: '0 auto' }} />
            </div>
        );
    }

    if (pendingRequests.length === 0) {
        return (
            <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                    ✅ No pending approvals
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pendingRequests.map((request) => {
                const startDate = new Date(request.start_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                });
                const endDate = new Date(request.end_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                });

                const isProcessing = actionLoading === request.id;

                return (
                    <div
                        key={request.id}
                        className="card"
                        style={{
                            padding: '1rem',
                            opacity: isProcessing ? 0.6 : 1,
                            pointerEvents: isProcessing ? 'none' : 'auto',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                                    {request.requester?.full_name || 'Unknown'}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                                    {request.leave_type === 'annual' ? '🏖️' : '🏥'} {request.leave_type} • {startDate} - {endDate}
                                </div>
                                <div style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 'bold',
                                    color: 'var(--color-primary)'
                                }}>
                                    {request.days_requested} day{request.days_requested !== 1 ? 's' : ''}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={() => handleApprove(request)}
                                    className="btn btn-sm"
                                    style={{
                                        backgroundColor: '#16a34a',
                                        color: 'white',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.8rem',
                                    }}
                                    disabled={!!actionLoading}
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    onClick={() => handleReject(request)}
                                    className="btn btn-sm"
                                    style={{
                                        backgroundColor: '#ef4444',
                                        color: 'white',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.8rem',
                                    }}
                                    disabled={!!actionLoading}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
