'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { MedicalClaim } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import ClaimCard from '@/components/ClaimCard';
import { CheckCircle, ArrowLeft, Check, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { formatSGD } from '@/lib/money';

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

type Tab = 'pending' | 'history';

export default function AdminClaimsPage() {
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();
    const { user, profile, loading: authLoading } = useAuth();

    const [tab, setTab] = useState<Tab>('pending');
    const [claims, setClaims] = useState<MedicalClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [amounts, setAmounts] = useState<Record<string, string>>({});

    const isOwner = profile?.role === 'owner';
    const isAdmin = profile?.role === 'manager' || profile?.role === 'owner';

    const load = useCallback(async (which: Tab) => {
        try {
            setLoading(true);
            setError(null);
            const data = await jsonOrError(await fetch(`/api/claims?scope=${which}`)) as { claims: MedicalClaim[] };
            setClaims(data.claims);
            setAmounts(Object.fromEntries(data.claims.map(c => [c.id, c.amount_claimed.toFixed(2)])));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load claims');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isAdmin) { router.push(`/c/${slug}/claims`); return; }
        if (isAdmin) load(tab);
    }, [user, profile, authLoading, isAdmin, load, router, slug, tab]);

    const decide = async (claim: MedicalClaim, action: 'approve' | 'reject') => {
        const body: Record<string, unknown> = { action };
        if (action === 'approve') {
            const input = amounts[claim.id]?.trim();
            const value = input ? input : claim.amount_claimed.toFixed(2);
            if (Number(value) > claim.amount_claimed) {
                toast(`Approved amount cannot exceed the claimed ${formatSGD(claim.amount_claimed)}`, 'error');
                return;
            }
            body.amount_approved = value;
        } else {
            const note = prompt('Reason for rejecting (optional):');
            if (note === null) return;
            if (note.trim()) body.note = note.trim();
        }
        setProcessing(claim.id);
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }));
            toast(action === 'approve' ? 'Claim approved' : 'Claim rejected', 'success');
        } catch (err) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
        } finally {
            setProcessing(null);
            await load(tab);
        }
    };

    const purge = async (claim: MedicalClaim) => {
        const refund = claim.status === 'approved' && claim.amount_approved !== null
            ? ` ${formatSGD(claim.amount_approved)} will be returned to ${claim.profile?.full_name ?? 'the employee'}'s balance.`
            : '';
        if (!confirm(`Delete this ${claim.status} claim record?${refund}`)) return;
        setProcessing(claim.id);
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, { method: 'DELETE' }));
        } catch (err) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
        } finally {
            setProcessing(null);
            await load(tab);
        }
    };

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Medical Claims</h1>
                        <p className="page-subtitle">{isOwner ? 'Approve or reject receipts' : 'Owner approval required'}</p>
                    </section>

                    <div className="flex gap-sm mb-md">
                        <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('pending')}>Pending</button>
                        <button className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('history')}>History</button>
                    </div>

                    {error && (
                        <div className="form-error mb-md">
                            {error} <button className="text-button" onClick={() => load(tab)}>Retry</button>
                        </div>
                    )}

                    {loading ? (
                        <div className="loading"><div className="spinner" /></div>
                    ) : claims.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon"><CheckCircle size={48} /></div>
                            <div className="empty-state-title">{tab === 'pending' ? 'All caught up!' : 'No decided claims yet'}</div>
                        </div>
                    ) : (
                        <section className="section animate-in">
                            {claims.map(claim => (
                                <div key={claim.id} style={{ opacity: processing === claim.id ? 0.5 : 1 }}>
                                    <ClaimCard
                                        claim={claim}
                                        userName={`${claim.profile?.full_name ?? 'Unknown'} · balance ${formatSGD(claim.profile?.medical_claim_balance ?? 0)}`}
                                        onDelete={isOwner && tab === 'history' ? () => purge(claim) : undefined}
                                    />
                                    {isOwner && claim.status === 'pending' && (
                                        <div className="card mb-lg" style={{ marginTop: '-0.5rem' }}>
                                            <label className="form-label" htmlFor={`amt-${claim.id}`}>Approve amount (S$)</label>
                                            <input
                                                id={`amt-${claim.id}`}
                                                type="text"
                                                inputMode="decimal"
                                                className="form-input"
                                                value={amounts[claim.id] ?? ''}
                                                onChange={(e) => setAmounts(a => ({ ...a, [claim.id]: e.target.value }))}
                                                disabled={!!processing}
                                            />
                                            <div className="leave-request-actions mt-sm">
                                                <button className="btn btn-success btn-sm" onClick={() => decide(claim, 'approve')} disabled={!!processing}>
                                                    <Check size={16} /><span>Approve</span>
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => decide(claim, 'reject')} disabled={!!processing}>
                                                    <X size={16} /><span>Reject</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {!isOwner && claim.status === 'pending' && (
                                        <p className="text-muted mb-lg" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>Owner approval required</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}

                    <button className="btn btn-ghost btn-block mt-lg" onClick={() => router.push(`/c/${slug}/admin`)}>
                        <ArrowLeft size={18} /><span>Back to Admin</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
