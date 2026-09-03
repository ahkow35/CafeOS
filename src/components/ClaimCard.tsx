'use client';

import { Receipt, Trash2, FileText } from 'lucide-react';
import type { MedicalClaim } from '@/lib/database.types';
import { formatSGD } from '@/lib/money';
import { formatDateShort } from '@/lib/dateUtils';
import { openMedicalCert } from '@/lib/storageUtils';

interface ClaimCardProps {
    claim: MedicalClaim;
    userName?: string;
    onCancel?: () => void;   // claimant, pending only
    onDelete?: () => void;   // owner purge, decided only
}

const STATUS: Record<MedicalClaim['status'], { label: string; className: string }> = {
    pending: { label: 'Awaiting Owner', className: 'badge-warning' },
    approved: { label: 'Approved', className: 'badge-success' },
    rejected: { label: 'Rejected', className: 'badge-danger' },
};

export default function ClaimCard({ claim, userName, onCancel, onDelete }: ClaimCardProps) {
    const status = STATUS[claim.status];
    const partial = claim.status === 'approved' && claim.amount_approved !== null && claim.amount_approved < claim.amount_claimed;

    return (
        <div className="card leave-request-card" style={{ position: 'relative' }}>
            {onCancel && claim.status === 'pending' && (
                <button
                    onClick={onCancel}
                    className="btn btn-ghost btn-sm"
                    style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--color-danger)', padding: '4px 8px' }}
                    title="Cancel claim"
                >
                    <Trash2 size={18} />
                </button>
            )}

            <div className="leave-request-header" style={{ paddingRight: onCancel ? '40px' : 0 }}>
                <div className="leave-request-type">
                    <Receipt size={20} className="leave-type-icon" />
                    <span>Medical Claim</span>
                </div>
                <span className={`badge ${status.className}`}>{status.label}</span>
            </div>

            {userName && (
                <div className="leave-request-user"><strong>{userName}</strong></div>
            )}

            <div className="leave-request-dates">
                <span className="leave-date-range">Receipt {formatDateShort(claim.receipt_date)}</span>
                <span className="leave-days">
                    {claim.status === 'approved' && claim.amount_approved !== null
                        ? formatSGD(claim.amount_approved)
                        : formatSGD(claim.amount_claimed)}
                </span>
            </div>

            {partial && (
                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                    Claimed {formatSGD(claim.amount_claimed)}, approved {formatSGD(claim.amount_approved!)}
                </div>
            )}

            <div className="leave-request-details" style={{ marginTop: '1rem', padding: '1rem', border: '2px solid black' }}>
                {claim.description && (
                    <div className="mb-sm">
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Description</div>
                        <div>{claim.description}</div>
                    </div>
                )}
                {claim.decision_note && (
                    <div className="mb-sm">
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Owner note</div>
                        <div>{claim.decision_note}</div>
                    </div>
                )}
                <button
                    onClick={() => openMedicalCert(claim.receipt_url)}
                    className="btn btn-outline btn-sm btn-block"
                    style={{ marginTop: '0.5rem' }}
                >
                    <FileText size={16} />
                    <span>View Receipt</span>
                </button>
            </div>

            {onDelete && claim.status !== 'pending' && (
                <button
                    onClick={onDelete}
                    className="btn btn-ghost btn-sm btn-block mt-sm"
                    style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}
                >
                    <Trash2 size={14} />
                    <span>Delete Record</span>
                </button>
            )}
        </div>
    );
}
