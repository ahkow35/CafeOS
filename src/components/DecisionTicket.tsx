'use client';

import { LeaveRequest } from '@/lib/database.types';
import { formatDateLong } from '@/lib/dateUtils';
import { FileText, Calendar } from 'lucide-react';

interface DecisionTicketProps {
    request: LeaveRequest;
    userName?: string;
    onApprove: () => void;
    onReject: () => void;
    processing: boolean;
}

export default function DecisionTicket({
    request,
    userName,
    onApprove,
    onReject,
    processing
}: DecisionTicketProps) {
    const isMedical = request.leave_type === 'medical';

    return (
        <div className="card" style={{ padding: 0, marginBottom: 'var(--space-lg)' }}>
            {/* Header */}
            <div style={{
                background: 'var(--color-black)',
                color: 'var(--color-white)',
                padding: 'var(--space-sm) var(--space-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-heading)',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                <span>TICKET #{request.id.slice(0, 6)}</span>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    {request.is_retrospective && (
                        <span style={{
                            background: 'var(--color-warning)',
                            color: 'var(--color-black)',
                            padding: '2px 8px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                        }}>
                            RETRO
                        </span>
                    )}
                    <span style={{
                        background: isMedical ? 'var(--color-orange)' : 'var(--color-neon)',
                        color: 'var(--color-black)',
                        padding: '2px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                    }}>
                        {request.leave_type}
                    </span>
                </div>
            </div>

            {/* Body */}
            <div style={{ padding: 'var(--space-md)' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-md)',
                    marginBottom: 'var(--space-md)'
                }}>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>REQUESTER</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{userName || 'Unknown'}</div>
                    </div>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>DURATION</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{request.days_requested} DAYS</div>
                    </div>
                </div>

                <div style={{
                    borderTop: '2px solid var(--color-concrete)',
                    borderBottom: '2px solid var(--color-concrete)',
                    padding: 'var(--space-sm) 0',
                    marginBottom: 'var(--space-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-md)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-body)' }}>{formatDateLong(request.start_date)}</span>
                    </div>
                    <div className="text-muted">➡</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-body)' }}>{formatDateLong(request.end_date)}</span>
                    </div>
                </div>

                {(request.reason || request.attachment_url) && (
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                        {request.reason && (
                            <div style={{ marginBottom: '0.5rem' }}>
                                <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>REASON</div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>{request.reason}</div>
                            </div>
                        )}
                        {request.attachment_url && (
                            <a
                                href={request.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm"
                                style={{ textDecoration: 'none', marginTop: '0.5rem' }}
                            >
                                <FileText size={14} />
                                VIEW PROOF
                            </a>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                    <button
                        onClick={onReject}
                        disabled={processing}
                        className="decision-btn decision-btn-reject"
                    >
                        REJECT
                    </button>
                    <button
                        onClick={onApprove}
                        disabled={processing}
                        className="decision-btn decision-btn-approve"
                    >
                        APPROVE
                    </button>
                </div>
            </div>
        </div>
    );
}
