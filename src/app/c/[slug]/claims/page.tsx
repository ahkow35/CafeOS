'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import type { MedicalClaim } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import ClaimBalanceCard from '@/components/ClaimBalanceCard';
import ClaimCard from '@/components/ClaimCard';
import { BarChart3, Plus, Clock, History, Inbox, ArrowLeft } from 'lucide-react';
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

export default function ClaimsPage() {
    const { user, profile, loading, refreshProfile } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [claims, setClaims] = useState<MedicalClaim[]>([]);
    const [claimsLoading, setClaimsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/login');
    }, [user, loading, router]);

    const fetchClaims = useCallback(async () => {
        setFetchError(null);
        try {
            const data = await jsonOrError(await fetch('/api/claims?scope=mine')) as { claims: MedicalClaim[] };
            setClaims(data.claims ?? []);
        } catch (err) {
            console.error('Failed to load claims:', err);
            setFetchError('Failed to load your claims. Please try again.');
        } finally {
            setClaimsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchClaims();
    }, [user, fetchClaims]);

    const handleCancel = async (claim: MedicalClaim) => {
        if (!confirm(`Cancel this ${formatSGD(claim.amount_claimed)} claim? Nothing has been deducted yet.`)) return;
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, { method: 'DELETE' }));
            await refreshProfile();
            await fetchClaims();
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to cancel claim.', 'error');
        }
    };

    if (loading || !user) {
        return <div className="loading" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
    }

    const pending = claims.filter(c => c.status === 'pending');
    const past = claims.filter(c => c.status !== 'pending');
    const pendingTotal = pending.reduce((s, c) => s + c.amount_claimed, 0);

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Medical Claims</h1>
                        <p className="page-subtitle">Submit receipts against your yearly cap</p>
                    </section>

                    <section className="section animate-in">
                        <h2 className="section-title"><BarChart3 size={20} /><span>Your Balance</span></h2>
                        <ClaimBalanceCard available={profile?.medical_claim_balance ?? 0} pending={pendingTotal} />
                    </section>

                    <section className="section animate-in">
                        <Link href={`/c/${slug}/claims/new`} className="btn btn-primary btn-block btn-lg">
                            <Plus size={20} /><span>Submit a Claim</span>
                        </Link>
                    </section>

                    {pending.length > 0 && (
                        <section className="section animate-in">
                            <h2 className="section-title"><Clock size={20} /><span>Pending</span></h2>
                            {pending.map(c => <ClaimCard key={c.id} claim={c} onCancel={() => handleCancel(c)} />)}
                        </section>
                    )}

                    <section className="section animate-in">
                        <h2 className="section-title"><History size={20} /><span>History</span></h2>
                        {fetchError ? (
                            <div className="empty-state">
                                <div className="empty-state-title" style={{ color: '#ef4444' }}>Failed to load claims</div>
                                <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                                <button className="btn btn-primary" onClick={fetchClaims}>Try again</button>
                            </div>
                        ) : claimsLoading ? (
                            <div className="loading"><div className="spinner" /></div>
                        ) : past.length > 0 ? (
                            past.map(c => <ClaimCard key={c.id} claim={c} />)
                        ) : pending.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon"><Inbox size={48} /></div>
                                <div className="empty-state-title">No claims yet</div>
                                <p>Submit a receipt to get started</p>
                            </div>
                        ) : null}
                    </section>

                    <button className="btn btn-ghost btn-block mt-lg" onClick={() => router.push(`/c/${slug}/leave`)}>
                        <ArrowLeft size={18} /><span>Back to Leave</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
