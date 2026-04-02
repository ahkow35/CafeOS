'use client';

import { Palmtree, Stethoscope, Check, X, Trash2 } from 'lucide-react';
import { LeaveRequest } from '@/lib/database.types';

interface LeaveRequestCardProps {
    request: LeaveRequest;
    userName?: string;
    showActions?: boolean;
    onApprove?: () => void;
    onReject?: () => void;
    onCancel?: () => void;
}

export default function LeaveRequestCard({
    request,
    userName,
    showActions = false,
    onApprove,
    onReject,
    onCancel,
}: LeaveRequestCardProps) {
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        });
    };

    const getStatusDisplay = (status: LeaveRequest['status']) => {
        switch (status) {
            case 'pending_manager':
                return { label: 'Awaiting Manager', className: 'badge-warning' };
            case 'pending_owner':
                return { label: 'Awaiting Owner', className: 'badge-info' };
            case 'approved':
                return { label: 'Approved', className: 'badge-success' };
            case 'rejected':
                return { label: 'Rejected', className: 'badge-danger' };
            default:
                return { label: status, className: 'badge-neutral' };
        }
    };

    const statusDisplay = getStatusDisplay(request.status);

    return (
        <div className="card leave-request-card" style={{ position: 'relative' }}>
            {/* Cancel Button for Pending Requests */}
            {onCancel && (request.status === 'pending_manager' || request.status === 'pending_owner') && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onCancel();
                    }}
                    className="btn btn-ghost btn-sm"
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        color: 'var(--color-danger)',
                        padding: '4px 8px'
                    }}
                    title="Recall Request"
                >
                    <Trash2 size={18} />
                </button>
            )}

            <div className="leave-request-header" style={{ paddingRight: onCancel ? '40px' : '0' }}>
                <div className="leave-request-type">
                    {request.leave_type === 'annual' ? (
                        <Palmtree size={20} className="leave-type-icon" />
                    ) : (
                        <Stethoscope size={20} className="leave-type-icon" />
                    )}
                    <span>{request.leave_type === 'annual' ? 'Annual Leave' : 'Medical Leave'}</span>
                    {request.is_retrospective && (
                        <span className="badge badge-neutral" style={{ fontSize: '0.65rem', marginLeft: '0.25rem' }}>
                            Retrospective
                        </span>
                    )}
                </div>
                <span className={`badge ${statusDisplay.className}`}>
                    {statusDisplay.label}
                </span>
            </div>

            {userName && (
                <div className="leave-request-user">
                    <strong>{userName}</strong>
                </div>
            )}

            <div className="leave-request-dates">
                <span className="leave-date-range">
                    {formatDate(request.start_date)} → {formatDate(request.end_date)}
                </span>
                <span className="leave-days">
                    {request.days_requested} day{request.days_requested !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Medical Leave Details */}
            {(request.reason || request.attachment_url) && (
                <div className="leave-request-details" style={{ marginTop: '1rem', padding: '1rem', border: '2px solid black' }}>
                    {request.reason && (
                        <div className="mb-sm">
                            <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Reason</div>
                            <div>{request.reason}</div>
                        </div>
                    )}
                    {request.attachment_url && (
                        <a
                            href={request.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline btn-sm btn-block"
                            style={{ marginTop: '0.5rem', textDecoration: 'none' }}
                        >
                            <Stethoscope size={16} />
                            <span>View Proof</span>
                        </a>
                    )}
                </div>
            )}

            {showActions && (request.status === 'pending_manager' || request.status === 'pending_owner') && (
                <div className="leave-request-actions">
                    <button
                        className="btn btn-success btn-sm"
                        onClick={onApprove}
                    >
                        <Check size={16} />
                        <span>Approve</span>
                    </button>
                    <button
                        className="btn btn-danger btn-sm"
                        onClick={onReject}
                    >
                        <X size={16} />
                        <span>Reject</span>
                    </button>
                </div>
            )}
        </div>
    );
}
