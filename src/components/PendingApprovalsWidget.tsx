'use client';

import { useEffect, useState, useCallback } from 'react';
import { LeaveRequest } from '@/lib/database.types';
import { Check, X, Loader2 } from 'lucide-react';
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

function StageBadge({ status }: { status: string }) {
    const isPendingManager = status === 'pending_manager';
    return (
        <span style={{
            display: 'inline-block',
            marginTop: '0.35rem',
            fontSize: '0.7rem',
            fontWeight: 700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.05em',
            padding: '2px 6px',
            borderRadius: '3px',
            backgroundColor: isPendingManager ? 'var(--color-orange)' : 'var(--color-black)',
            color: isPendingManager ? 'var(--color-white)' : 'var(--color-orange)',
        }}>
            {isPendingManager ? 'Awaiting Manager' : 'Owner Approval'}
        </span>
    );
}

interface PendingRow extends LeaveRequest {
    profile: {
        full_name: string;
        phone_e164: string;
        role: 'staff' | 'manager' | 'owner' | 'part_timer';
        annual_leave_balance: number;
        medical_leave_balance: number;
    };
}

interface PendingApprovalsWidgetProps {
    userRole: 'manager' | 'owner';
}

export default function PendingApprovalsWidget({ userRole }: PendingApprovalsWidgetProps) {
    const toast = useToast();
    const [pendingRequests, setPendingRequests] = useState<PendingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const loadPendingRequests = useCallback(async () => {
        setLoading(true);
        try {
            const data = await jsonOrError(await fetch('/api/leave-requests?scope=pending')) as { requests: PendingRow[] };
            setPendingRequests(data.requests ?? []);
        } catch (err) {
            console.error('Error loading pending requests:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPendingRequests();
    }, [loadPendingRequests]);

    const act = async (request: PendingRow, action: 'approve' | 'reject') => {
        if (action === 'reject' && !confirm(`Are you sure you want to reject this ${request.leave_type} leave request?`)) {
            return;
        }
        setActionLoading(request.id);
        try {
            await jsonOrError(await fetch(`/api/leave-requests/${request.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            }));
            await loadPendingRequests();
        } catch (err: unknown) {
            console.error(`Error ${action}ing request:`, err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
            toast(`Failed to ${action}: ${errorMessage}`, 'error');
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
                    No pending approvals
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
                                    {request.profile?.full_name || 'Unknown'}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                                    {request.leave_type} • {startDate} - {endDate}
                                </div>
                                <div style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 'bold',
                                    color: 'var(--color-primary)'
                                }}>
                                    {request.days_requested} day{request.days_requested !== 1 ? 's' : ''}
                                </div>
                                <StageBadge status={request.status} />
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={() => act(request, 'approve')}
                                    className="btn btn-sm"
                                    style={{
                                        backgroundColor: 'var(--color-stali-green)',
                                        color: 'white',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.8rem',
                                    }}
                                    disabled={!!actionLoading || (userRole === 'owner' && request.status === 'pending_manager')}
                                >
                                    <Check size={14} />
                                </button>
                                <button
                                    onClick={() => act(request, 'reject')}
                                    className="btn btn-sm"
                                    style={{
                                        backgroundColor: 'var(--color-rust)',
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
