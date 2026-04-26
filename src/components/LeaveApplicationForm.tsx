'use client';

import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Upload, FileText } from 'lucide-react';

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

export default function LeaveApplicationForm() {
    const { user, profile, refreshProfile } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    const endDateRef = useRef<HTMLInputElement>(null);
    const reasonRef = useRef<HTMLTextAreaElement>(null);

    const [leaveType, setLeaveType] = useState<'annual' | 'medical'>(() => {
        const t = searchParams.get('type');
        return t === 'annual' || t === 'medical' ? t : 'annual';
    });
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);

    const calculateDays = () => {
        if (!startDate || !endDate) return 0;
        const start = new Date(startDate + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');
        if (end < start) return 0;
        let days = 0;
        const current = new Date(start);
        while (current <= end) {
            days++;
            current.setDate(current.getDate() + 1);
        }
        return days;
    };

    const daysRequested = calculateDays();
    const availableBalance = leaveType === 'annual'
        ? profile?.annual_leave_balance ?? 0
        : profile?.medical_leave_balance ?? 0;

    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;
    const isRetrospective = !!startDate && startDate < today;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!user?.id) {
            setError('Your session has expired. Please log out and log in again.');
            return;
        }

        if (!startDate || !endDate) {
            setError('Please select both start and end dates');
            return;
        }

        if (daysRequested === 0) {
            setError('End date must be after start date');
            return;
        }

        if (parseInt(startDate.slice(0, 4), 10) !== currentYear || parseInt(endDate.slice(0, 4), 10) !== currentYear) {
            setError('Leave dates must fall within the current calendar year.');
            return;
        }

        if (daysRequested > availableBalance) {
            setError(
                `Insufficient ${leaveType === 'annual' ? 'annual' : 'medical'} leave balance. ` +
                `You requested ${daysRequested} day${daysRequested !== 1 ? 's' : ''} but only have ` +
                `${availableBalance} day${availableBalance !== 1 ? 's' : ''} remaining.`
            );
            return;
        }

        if (leaveType === 'medical') {
            if (!reason.trim()) {
                setError('Please provide a reason for medical leave');
                return;
            }
            if (!file) {
                setError('Please upload a Medical Certificate (MC)');
                return;
            }
        }

        setSubmitting(true);
        let attachmentUrl: string | null = null;

        if (leaveType === 'medical' && file) {
            setUploading(true);
            try {
                const form = new FormData();
                form.append('file', file);
                const data = await jsonOrError(await fetch('/api/uploads/medical-cert', {
                    method: 'POST',
                    body: form,
                })) as { url: string };
                attachmentUrl = data.url;
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Upload failed';
                setError(`Upload failed: ${errorMessage}`);
                setSubmitting(false);
                setUploading(false);
                return;
            }
            setUploading(false);
        }

        try {
            await jsonOrError(await fetch('/api/leave-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leave_type: leaveType,
                    start_date: startDate,
                    end_date: endDate,
                    reason: leaveType === 'medical' ? reason : null,
                    attachment_url: attachmentUrl,
                }),
            }));

            await refreshProfile();
            router.push('/leave');
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
            setError(errorMessage);
            setSubmitting(false);
        }
    };

    return (
        <main className="page" style={{ overflowX: 'hidden' }}>
            <div className="container">
                <section className="page-header animate-in">
                    <h1 className="page-title">Apply for Leave</h1>
                    <p className="page-subtitle">Submit your time off request</p>
                </section>

                <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '100%' }}>
                    <section className="section animate-in">
                        <label className="form-label">Leave Type</label>
                        <div className="stats-grid">
                            <button
                                type="button"
                                className={`stat-card ${leaveType === 'annual' ? '' : ''}`}
                                onClick={() => setLeaveType('annual')}
                                style={{
                                    cursor: 'pointer',
                                    border: leaveType === 'annual' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                    textAlign: 'center'
                                }}
                            >
                                <div className="stat-label">Annual Leave</div>
                                <div className="text-muted mt-sm" style={{ fontSize: '0.75rem' }}>
                                    {profile?.annual_leave_balance} days left
                                </div>
                            </button>
                            <button
                                type="button"
                                className="stat-card"
                                onClick={() => setLeaveType('medical')}
                                style={{
                                    cursor: 'pointer',
                                    border: leaveType === 'medical' ? '2px solid var(--color-primary)' : '2px solid transparent',
                                    textAlign: 'center'
                                }}
                            >
                                <div className="stat-label">Medical Leave</div>
                                <div className="text-muted mt-sm" style={{ fontSize: '0.75rem' }}>
                                    {profile?.medical_leave_balance} days left
                                </div>
                            </button>
                        </div>
                    </section>

                    <section className="section animate-in">
                        <div className="form-group">
                            <label htmlFor="startDate" className="form-label">
                                Start Date
                            </label>
                            <input
                                id="startDate"
                                type="date"
                                className="form-input"
                                value={startDate}
                                onChange={(e) => {
                                    setStartDate(e.target.value);
                                    if (e.target.value && endDateRef.current) {
                                        setTimeout(() => {
                                            endDateRef.current?.focus();
                                        }, 150);
                                    }
                                }}
                                min={yearStart}
                                max={yearEnd}
                                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="endDate" className="form-label">
                                End Date
                            </label>
                            <input
                                ref={endDateRef}
                                id="endDate"
                                type="date"
                                className="form-input"
                                value={endDate}
                                onChange={(e) => {
                                    setEndDate(e.target.value);
                                    if (e.target.value && leaveType === 'medical' && reasonRef.current) {
                                        setTimeout(() => {
                                            reasonRef.current?.focus();
                                            reasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        }, 200);
                                    }
                                }}
                                min={startDate || yearStart}
                                max={yearEnd}
                                style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                required
                            />
                        </div>
                    </section>

                    {isRetrospective && (
                        <section className="section animate-in">
                            <div className="card" style={{ border: '2px solid var(--color-warning, #f59e0b)', background: 'var(--color-warning-light, #fffbeb)' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Retrospective Request</div>
                                        <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                                            These dates are in the past. Your request will go through the standard approval process.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                    {leaveType === 'medical' && (
                        <section className="section animate-in">
                            <div className="form-group">
                                <label className="form-label">
                                    Reason for Leave <span className="text-danger">*</span>
                                </label>
                                <textarea
                                    ref={reasonRef}
                                    className="form-input"
                                    rows={3}
                                    placeholder="e.g. Fever, Flu, Dental"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    required
                                    style={{ resize: 'none', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Medical Certificate (MC) <span className="text-danger">*</span>
                                </label>
                                <div className="file-upload-wrapper" style={{ position: 'relative' }}>
                                    <input
                                        type="file"
                                        id="mc-upload"
                                        accept=".jpg,.png,.pdf"
                                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                                        className="hidden-file-input"
                                        style={{
                                            opacity: 0,
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            cursor: 'pointer',
                                            zIndex: 2
                                        }}
                                        required
                                    />
                                    <div
                                        className="btn btn-outline btn-block"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            padding: '1rem',
                                            border: '2px dashed var(--color-black)',
                                            background: file ? 'var(--color-concrete)' : 'transparent'
                                        }}
                                    >
                                        {file ? (
                                            <>
                                                <FileText size={20} />
                                                <span className="truncate">{file.name}</span>
                                            </>
                                        ) : (
                                            <>
                                                <Upload size={20} />
                                                <span>Upload MC (PDF/Image)</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <p className="form-hint mt-xs text-muted" style={{ fontSize: '0.75rem' }}>
                                    Supported: .jpg, .png, .pdf (Max 5MB)
                                </p>
                            </div>
                        </section>
                    )}

                    {daysRequested > 0 && (
                        <section className="section animate-in">
                            <div className="card">
                                <div className="card-header">
                                    <div>
                                        <div className="card-title">Request Summary</div>
                                        <div className="card-subtitle">
                                            {leaveType === 'annual' ? 'Annual' : 'Medical'} Leave
                                        </div>
                                    </div>
                                </div>
                                <div className="leave-days">
                                    {daysRequested} <span>day{daysRequested !== 1 ? 's' : ''}</span>
                                </div>
                                {daysRequested > availableBalance && (
                                    <div className="form-error mt-md">
                                        You only have {availableBalance} day{availableBalance !== 1 ? 's' : ''} left but requested {daysRequested}. Please shorten your dates.
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {error && (
                        <div className="form-error mb-md">
                            {error}
                        </div>
                    )}

                    <section className="section animate-in">
                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={submitting || daysRequested === 0 || daysRequested > availableBalance}
                            title={daysRequested > availableBalance ? `Insufficient balance (${availableBalance} days available)` : undefined}
                        >
                            {submitting ? (uploading ? 'Uploading Proof...' : 'Submitting...') : 'Submit Request'}
                        </button>

                        <button
                            type="button"
                            className="btn btn-ghost btn-block mt-md"
                            onClick={() => router.back()}
                        >
                            Cancel
                        </button>
                    </section>
                </form>
            </div>
        </main>
    );
}
