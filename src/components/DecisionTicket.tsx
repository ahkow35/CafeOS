'use client';

import { LeaveRequest } from '@/lib/database.types';
import { FileText, Calendar, Clock } from 'lucide-react';

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

    // Format Dates properly
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        }).toUpperCase();
    };

    return (
        <div className="card" style={{
            border: '2px solid var(--color-black)',
            padding: '0',
            marginBottom: 'var(--spacing-lg)',
            background: 'var(--color-white)'
        }}>
            {/* Ticket Header - High Contrast */}
            <div style={{
                background: 'var(--color-black)',
                color: 'var(--color-white)',
                padding: 'var(--spacing-sm) var(--spacing-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-heading)',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                <span>TICKET #{request.id.slice(0, 6)}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {request.is_retrospective && (
                        <span style={{
                            background: 'var(--color-warning, #f59e0b)',
                            color: 'var(--color-black)',
                            padding: '2px 8px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                        }}>
                            RETRO
                        </span>
                    )}
                    <span style={{
                        background: isMedical ? 'var(--color-neon-orange)' : 'var(--color-neon-green)',
                        color: 'var(--color-black)',
                        padding: '2px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                    }}>
                        {request.leave_type}
                    </span>
                </div>
            </div>

            {/* Ticket Body - Density */}
            <div style={{ padding: 'var(--spacing-md)' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--spacing-md)',
                    marginBottom: 'var(--spacing-md)'
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
                    padding: 'var(--spacing-sm) 0',
                    marginBottom: 'var(--spacing-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-md)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDate(request.start_date)}</span>
                    </div>
                    <div className="text-muted">➡</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatDate(request.end_date)}</span>
                    </div>
                </div>

                {(request.reason || request.attachment_url) && (
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                        {request.reason && (
                            <div style={{ marginBottom: '0.5rem' }}>
                                <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>REASON</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{request.reason}</div>
                            </div>
                        )}

                        {request.attachment_url && (
                            <a
                                href={request.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-outline btn-sm"
                                style={{
                                    textDecoration: 'none',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.8rem',
                                    marginTop: '0.5rem'
                                }}
                            >
                                <FileText size={14} />
                                VIEW PROOF
                            </a>
                        )}
                    </div>
                )}

                {/* Stamp Actions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                    <button
                        onClick={onReject}
                        disabled={processing}
                        style={{
                            background: 'var(--color-white)',
                            border: '2px solid var(--color-black)',
                            color: 'var(--color-black)',
                            padding: 'var(--spacing-md)',
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1.5rem',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            opacity: processing ? 0.5 : 1,
                            transition: 'all 0.1s'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--color-black)';
                            e.currentTarget.style.color = 'var(--color-neon-orange)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--color-white)';
                            e.currentTarget.style.color = 'var(--color-black)';
                        }}
                    >
                        REJECT
                    </button>

                    <button
                        onClick={onApprove}
                        disabled={processing}
                        style={{
                            background: 'var(--color-black)',
                            border: '2px solid var(--color-black)',
                            color: 'var(--color-white)',
                            padding: 'var(--spacing-md)',
                            fontFamily: 'var(--font-heading)',
                            fontSize: '1.5rem',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            opacity: processing ? 0.5 : 1,
                            transition: 'all 0.1s'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--color-white)';
                            e.currentTarget.style.color = 'var(--color-black)';
                            e.currentTarget.style.boxShadow = 'inset 0 0 0 2px var(--color-neon-green)';
                            e.currentTarget.style.borderColor = 'var(--color-neon-green)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--color-black)';
                            e.currentTarget.style.color = 'var(--color-white)';
                            e.currentTarget.style.boxShadow = 'none';
                            e.currentTarget.style.borderColor = 'var(--color-black)';
                        }}
                    >
                        APPROVE
                    </button>
                </div>
            </div>
        </div>
    );
}
