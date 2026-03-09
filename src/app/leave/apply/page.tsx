'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';

import { Upload, FileText } from 'lucide-react';

function LeaveApplicationForm() {
    const { user, profile } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClient();

    // Refs for auto-focus flow
    const endDateRef = useRef<HTMLInputElement>(null);
    const reasonRef = useRef<HTMLTextAreaElement>(null);

    const [leaveType, setLeaveType] = useState<'annual' | 'medical'>('annual');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reason, setReason] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Smart auto-fill: Detect leave type from query parameter
    useEffect(() => {
        const typeParam = searchParams.get('type');
        if (typeParam === 'annual' || typeParam === 'medical') {
            setLeaveType(typeParam);
        }
    }, [searchParams]);

    const calculateDays = () => {
        if (!startDate || !endDate) return 0;

        // Create dates at noon to avoid timezone/DST issues
        const start = new Date(startDate + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');

        // Reset to simple date comparison if needed, but T12:00:00 usually suffices
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // --- Session guard ---
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

        // --- Insufficient balance: show explicit error, not just a disabled button ---
        if (daysRequested > availableBalance) {
            setError(
                `Insufficient ${leaveType === 'annual' ? 'annual' : 'medical'} leave balance. ` +
                `You requested ${daysRequested} day${daysRequested !== 1 ? 's' : ''} but only have ` +
                `${availableBalance} day${availableBalance !== 1 ? 's' : ''} remaining.`
            );
            return;
        }

        // Check for overlapping leave requests
        const { data: existingLeaves, error: checkError } = await supabase
            .from('leave_requests')
            .select('start_date, end_date, leave_type, status')
            .eq('user_id', user.id)
            .in('status', ['pending_manager', 'pending_owner', 'approved'])
            .or(`and(start_date.lte.${endDate},end_date.gte.${startDate})`);

        if (checkError) {
            console.error('Error checking overlapping leaves:', checkError);
        } else if (existingLeaves && existingLeaves.length > 0) {
            const overlapping = existingLeaves[0];
            const overlapStart = new Date(overlapping.start_date).toLocaleDateString();
            const overlapEnd = new Date(overlapping.end_date).toLocaleDateString();
            setError(`You already have a ${overlapping.leave_type} leave request (${overlapping.status}) from ${overlapStart} to ${overlapEnd} that overlaps with these dates.`);
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
        let attachmentUrl = null;

        if (leaveType === 'medical' && file) {
            setUploading(true);
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${user.id}_${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage
                    .from('medical_certificates')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('medical_certificates')
                    .getPublicUrl(fileName);

                attachmentUrl = publicUrl;
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : 'Upload failed';
                setError(`Upload failed: ${errorMessage}`);
                setSubmitting(false);
                setUploading(false);
                return;
            }
            setUploading(false);
        }

        // Determine initial status based on user role
        // Staff: pending_manager (needs manager approval first)
        // Manager: pending_owner (skip manager step, go directly to owner)
        // Owner: approved (auto-approve)
        let initialStatus = 'pending_manager';
        if (profile?.role === 'manager') {
            initialStatus = 'pending_owner';
        } else if (profile?.role === 'owner') {
            initialStatus = 'approved';
        }

        try {
            const { error: submitError } = await supabase
                .from('leave_requests')
                .insert({
                    user_id: user.id,
                    leave_type: leaveType,
                    start_date: startDate,
                    end_date: endDate,
                    days_requested: daysRequested,
                    status: initialStatus,
                    reason: leaveType === 'medical' ? reason : null,
                    attachment_url: attachmentUrl,
                    ...(profile?.role === 'owner' && {
                        owner_action_by: user.id,
                        owner_action_at: new Date().toISOString(),
                    }),
                });

            if (submitError) {
                // Surface RLS / auth errors with a human-readable message
                if (submitError.code === 'PGRST301' || submitError.message?.includes('policy')) {
                    throw new Error('Permission denied. Your account may not have the right permissions. Please contact your manager.');
                }
                if (submitError.code === '42501') {
                    throw new Error('Permission denied by the database. Please try logging out and back in.');
                }
                throw new Error(submitError.message);
            }

            // Deduct balance immediately on successful submission
            // (for all roles — owner self-approval, manager escalation, and staff pending)
            const balanceField = leaveType === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
            const currentBalance = leaveType === 'annual'
                ? profile?.annual_leave_balance ?? 0
                : profile?.medical_leave_balance ?? 0;

            const { error: balanceError } = await supabase
                .from('profiles')
                .update({ [balanceField]: currentBalance - daysRequested })
                .eq('id', user.id);

            if (balanceError) {
                console.error('Balance update failed after successful submission:', balanceError);
                // Don't block the user — leave was submitted, just log the error
            }

            router.push('/leave');
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
            setError(errorMessage);
            setSubmitting(false);
        }
    };

    const today = new Date().toISOString().split('T')[0];

    return (
        <>
            <Header />
            <main className="page" style={{ overflowX: 'hidden' }}>
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">📝 Apply for Leave</h1>
                        <p className="page-subtitle">Submit your time off request</p>
                    </section>

                    <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: '100%' }}>
                        {/* Leave Type */}
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
                                    <div className="stat-value success">🏖️</div>
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
                                    <div className="stat-value success">🏥</div>
                                    <div className="stat-label">Medical Leave</div>
                                    <div className="text-muted mt-sm" style={{ fontSize: '0.75rem' }}>
                                        {profile?.medical_leave_balance} days left
                                    </div>
                                </button>
                            </div>
                        </section>

                        {/* Date Selection */}
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
                                        // Auto-focus end date input after start date is selected
                                        if (e.target.value && endDateRef.current) {
                                            setTimeout(() => {
                                                endDateRef.current?.focus();
                                                // Note: Removed showPicker() as it prevents date selection
                                            }, 150);
                                        }
                                    }}
                                    min={today}
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
                                        // Auto-focus reason field for medical leave after end date is selected
                                        if (e.target.value && leaveType === 'medical' && reasonRef.current) {
                                            // Longer delay to ensure date picker closes before focusing
                                            setTimeout(() => {
                                                reasonRef.current?.focus();
                                                // Scroll into view for better UX
                                                reasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            }, 200);
                                        }
                                    }}
                                    min={startDate || today}
                                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                                    required
                                />
                            </div>
                        </section>

                        {/* Medical Leave Extra Fields */}
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

                        {/* Summary */}
                        {daysRequested > 0 && (
                            <section className="section animate-in">
                                <div className="card">
                                    <div className="card-header">
                                        <div>
                                            <div className="card-title">Request Summary</div>
                                            <div className="card-subtitle">
                                                {leaveType === 'annual' ? '🏖️ Annual' : '🏥 Medical'} Leave
                                            </div>
                                        </div>
                                    </div>
                                    <div className="leave-days">
                                        {daysRequested} <span>day{daysRequested !== 1 ? 's' : ''}</span>
                                    </div>
                                    {daysRequested > availableBalance && (
                                <div className="form-error mt-md">
                                    ⚠️ You only have {availableBalance} day{availableBalance !== 1 ? 's' : ''} left but requested {daysRequested}. Please shorten your dates.
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
                                {submitting ? (uploading ? 'Uploading Proof...' : 'Submitting...') : '📤 Submit Request'}
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
            <BottomNav />
        </>
    );
}

export default function ApplyLeavePage() {
    return (
        <Suspense fallback={<div className="loading"><div className="spinner" /></div>}>
            <LeaveApplicationForm />
        </Suspense>
    );
}
