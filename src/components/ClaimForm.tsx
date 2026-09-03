'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Upload, FileText } from 'lucide-react';
import { formatSGD } from '@/lib/money';
import type { MedicalClaim } from '@/lib/database.types';

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

const MONEY_RE = /^\d{1,4}(\.\d{1,2})?$/;

export default function ClaimForm() {
    const { user, profile, refreshProfile } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();

    const [receiptDate, setReceiptDate] = useState('');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Today in Singapore, for the date input's max.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const balance = profile?.medical_claim_balance ?? 0;
    const available = Math.max(0, balance - pendingTotal);
    const amountNum = MONEY_RE.test(amount.trim()) ? Number(amount.trim()) : NaN;
    const overBudget = Number.isFinite(amountNum) && amountNum > available;

    useEffect(() => {
        (async () => {
            try {
                const data = await jsonOrError(await fetch('/api/claims?scope=mine')) as { claims: MedicalClaim[] };
                setPendingTotal(data.claims.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount_claimed, 0));
            } catch { /* the server enforces the limit regardless */ }
        })();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!user?.id) { setError('Your session has expired. Please log out and log in again.'); return; }
        if (!receiptDate) { setError('Please enter the receipt date'); return; }
        if (receiptDate > today) { setError('Receipt date cannot be in the future'); return; }
        if (!MONEY_RE.test(amount.trim()) || amountNum <= 0) { setError('Enter an amount like 45 or 45.50'); return; }
        if (overBudget) { setError(`You can claim up to ${formatSGD(available)} right now.`); return; }
        if (!file) { setError('Please attach the receipt'); return; }

        setSubmitting(true);
        setUploading(true);
        let receiptUrl: string;
        try {
            const form = new FormData();
            form.append('file', file);
            const data = await jsonOrError(await fetch('/api/uploads/claim-receipt', { method: 'POST', body: form })) as { url: string };
            receiptUrl = data.url;
        } catch (err) {
            setError(`Upload failed: ${err instanceof Error ? err.message : 'Upload failed'}`);
            setSubmitting(false);
            setUploading(false);
            return;
        }
        setUploading(false);

        try {
            await jsonOrError(await fetch('/api/claims', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receipt_date: receiptDate,
                    amount_claimed: amount.trim(),
                    description: description.trim() || null,
                    receipt_url: receiptUrl,
                }),
            }));
            await refreshProfile();
            router.push(`/c/${slug}/claims`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
            setSubmitting(false);
        }
    };

    return (
        <main className="page" style={{ overflowX: 'hidden' }}>
            <div className="container">
                <section className="page-header animate-in">
                    <h1 className="page-title">Submit a Claim</h1>
                    <p className="page-subtitle">Available now: {formatSGD(available)}</p>
                </section>

                <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                    <section className="section animate-in">
                        <div className="form-group">
                            <label htmlFor="receiptDate" className="form-label">Receipt Date</label>
                            <input
                                id="receiptDate"
                                type="date"
                                className="form-input"
                                value={receiptDate}
                                onChange={(e) => setReceiptDate(e.target.value)}
                                max={today}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="amount" className="form-label">Amount (S$)</label>
                            <input
                                id="amount"
                                type="text"
                                inputMode="decimal"
                                className="form-input"
                                placeholder="e.g. 45.50"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                required
                            />
                            {overBudget && (
                                <div className="form-error mt-sm">
                                    Exceeds your available balance of {formatSGD(available)}.
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="description" className="form-label">Description (optional)</label>
                            <textarea
                                id="description"
                                className="form-input"
                                rows={2}
                                maxLength={500}
                                placeholder="e.g. GP consultation, Raffles Medical"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                style={{ resize: 'none', width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Receipt <span className="text-danger">*</span></label>
                            <div className="file-upload-wrapper" style={{ position: 'relative' }}>
                                <input
                                    type="file"
                                    id="receipt-upload"
                                    accept=".jpg,.jpeg,.png,.heic,.pdf"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 2 }}
                                    required
                                />
                                <div
                                    className="btn btn-outline btn-block"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', border: '2px dashed var(--color-black)', background: file ? 'var(--color-concrete)' : 'transparent' }}
                                >
                                    {file ? (<><FileText size={20} /><span className="truncate">{file.name}</span></>)
                                          : (<><Upload size={20} /><span>Upload receipt (photo or PDF)</span></>)}
                                </div>
                            </div>
                            <p className="form-hint mt-xs text-muted" style={{ fontSize: '0.75rem' }}>
                                Supported: .jpg, .png, .heic, .pdf (Max 5MB)
                            </p>
                        </div>
                    </section>

                    {error && <div className="form-error mb-md">{error}</div>}

                    <section className="section animate-in">
                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={submitting || overBudget}
                        >
                            {submitting ? (uploading ? 'Uploading receipt…' : 'Submitting…') : 'Submit Claim'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-block mt-md" onClick={() => router.back()}>
                            Cancel
                        </button>
                    </section>
                </form>
            </div>
        </main>
    );
}
