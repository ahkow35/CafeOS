'use client';

import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import StatusBadge from '@/components/StatusBadge';
import { ArrowLeft, Calendar, Trash2 } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useEffect, useState, useCallback } from 'react';
import { LeaveRequest, User } from '@/lib/database.types';

type ProfileMini = Pick<User, 'full_name' | 'phone_e164' | 'role' | 'annual_leave_balance' | 'medical_leave_balance'>;

interface LeaveWithProfile extends LeaveRequest {
    profile: ProfileMini | null;
}

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

// The year a leave belongs to is the year it starts, read the same way the card shows the date.
// The API sends either a plain YYYY-MM-DD or a full timestamp of server-local midnight.
function startYear(leave: LeaveRequest): string {
    const raw = String(leave.start_date);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.slice(0, 4) : String(new Date(raw).getFullYear());
}

export default function AdminArchivePage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [leaves, setLeaves] = useState<LeaveWithProfile[]>([]);
    const [loadingData, setLoadingData] = useState(true);
    const [filter, setFilter] = useState<'all' | 'approved' | 'rejected'>('all');
    const [yearFilter, setYearFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<'all' | LeaveRequest['leave_type']>('all');
    const [employeeFilter, setEmployeeFilter] = useState<string>('all');
    const [employeeFilterName, setEmployeeFilterName] = useState('');
    const isOwner = profile?.role === 'owner';
    const isAdmin = profile?.role === 'manager' || profile?.role === 'owner';

    const fetchLeaveHistory = useCallback(async () => {
        setLoadingData(true);
        try {
            const data = await jsonOrError(await fetch('/api/leave-requests?scope=history')) as
                { requests: LeaveWithProfile[] };
            setLeaves(data.requests ?? []);
        } catch (err: unknown) {
            toast(`Failed to load history: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setLoadingData(false);
        }
    }, [toast]);

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isAdmin) { router.push(`/c/${slug}/admin`); return; }
        if (isAdmin) fetchLeaveHistory();
    }, [user, profile, loading, isAdmin, fetchLeaveHistory, router]);

    const handleDelete = async (leaveId: string) => {
        if (!confirm('Permanently delete this leave record? This cannot be undone.')) return;

        const previous = leaves;
        setLeaves(prev => prev.filter(l => l.id !== leaveId));

        try {
            await jsonOrError(await fetch(`/api/leave-requests/${leaveId}`, { method: 'DELETE' }));
        } catch (err: unknown) {
            toast(`Failed to delete record: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
            setLeaves(previous);
        }
    };

    // Year, leave type and employee narrow the list first; the status tabs and their counts apply on top.
    const matching = leaves.filter(l =>
        (yearFilter === 'all' || startYear(l) === yearFilter) &&
        (typeFilter === 'all' || l.leave_type === typeFilter) &&
        (employeeFilter === 'all' || l.user_id === employeeFilter)
    );
    const filteredLeaves = filter === 'all'
        ? matching
        : matching.filter(l => l.status === filter);
    const filtersActive = yearFilter !== 'all' || typeFilter !== 'all' || employeeFilter !== 'all';

    // Options come from the records on hand. A chosen value stays listed even after its last record is deleted.
    const years = Array.from(new Set([...leaves.map(startYear), ...(yearFilter === 'all' ? [] : [yearFilter])]))
        .sort((a, b) => b.localeCompare(a));
    const employees = new Map<string, string>();
    for (const l of leaves) employees.set(l.user_id, l.profile?.full_name || 'Unknown User');
    if (employeeFilter !== 'all' && !employees.has(employeeFilter)) employees.set(employeeFilter, employeeFilterName);
    const employeeOptions = Array.from(employees, ([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const clearFilters = () => {
        setYearFilter('all');
        setTypeFilter('all');
        setEmployeeFilter('all');
    };

    if (loading || !profile || !isAdmin) {
        return <div className="loading"><div className="spinner" /></div>;
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Leave history</h1>
                        <p className="page-subtitle">Historical leave records</p>
                    </section>

                    <div className="animate-in" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 'var(--space-sm)',
                        marginBottom: 'var(--space-md)'
                    }}>
                        <select
                            className="form-input form-select"
                            aria-label="Year"
                            value={yearFilter}
                            onChange={e => setYearFilter(e.target.value)}
                        >
                            <option value="all">All years</option>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <select
                            className="form-input form-select"
                            aria-label="Leave type"
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value as typeof typeFilter)}
                        >
                            <option value="all">All types</option>
                            <option value="annual">Annual</option>
                            <option value="medical">Medical</option>
                        </select>
                        <select
                            className="form-input form-select"
                            aria-label="Employee"
                            value={employeeFilter}
                            onChange={e => {
                                setEmployeeFilter(e.target.value);
                                setEmployeeFilterName(e.target.selectedOptions[0]?.text ?? '');
                            }}
                            style={{ gridColumn: '1 / -1' }}
                        >
                            <option value="all">All employees</option>
                            {employeeOptions.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                    </div>

                    <div className="animate-in" style={{
                        display: 'flex',
                        gap: 'var(--space-sm)',
                        marginBottom: 'var(--space-md)',
                        borderBottom: 'var(--border-width) solid var(--color-concrete)',
                        paddingBottom: 'var(--space-sm)'
                    }}>
                        {(['all', 'approved', 'rejected'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                                style={{ textTransform: 'var(--text-transform-capitalize)' }}
                            >
                                {f === 'all' ? `All (${matching.length})` :
                                    f === 'approved' ? `Approved (${matching.filter(l => l.status === 'approved').length})` :
                                        `Declined (${matching.filter(l => l.status === 'rejected').length})`}
                            </button>
                        ))}
                    </div>

                    {loadingData ? (
                        <div className="loading"><div className="spinner" /></div>
                    ) : filteredLeaves.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon">
                                <Calendar size={48} />
                            </div>
                            <div className="empty-state-title">No records found</div>
                            {filtersActive ? (
                                <>
                                    <p>No records match these filters.</p>
                                    <button className="btn btn-ghost btn-sm mt-md" onClick={clearFilters}>
                                        Clear filters
                                    </button>
                                </>
                            ) : (
                                <p>No {filter !== 'all' ? filter : ''} leave history yet.</p>
                            )}
                        </div>
                    ) : (
                        <div className="animate-in">
                            {filteredLeaves.map(leave => (
                                <div key={leave.id} className="card" style={{ marginBottom: 'var(--space-md)' }}>
                                    <div className="card-header" style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}>
                                        <div>
                                            <div className="card-title" style={{
                                                fontFamily: 'var(--font-heading)',
                                                textTransform: 'var(--text-transform-heading)'
                                            }}>
                                                {leave.profile?.full_name || 'Unknown User'}
                                            </div>
                                            <div className="card-subtitle" style={{ fontSize: '0.75rem' }}>
                                                {leave.profile?.role} • {leave.leave_type === 'annual' ? 'Annual' : 'Medical'}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <StatusBadge workflow="leave" status={leave.status} />
                                            {isOwner && (
                                                <button
                                                    onClick={() => handleDelete(leave.id)}
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--color-danger)', padding: '4px 8px' }}
                                                    title="Delete record"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{
                                        padding: 'var(--space-md)',
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                        gap: 'var(--space-sm)',
                                        borderTop: 'var(--border-subtle)'
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)' }}>
                                                Dates
                                            </div>
                                            <div style={{ fontWeight: 'var(--font-weight-bold)' }}>
                                                {new Date(leave.start_date).toLocaleDateString()} - {new Date(leave.end_date).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)' }}>
                                                Days
                                            </div>
                                            <div style={{ fontWeight: 'var(--font-weight-bold)' }}>
                                                {leave.days_requested} day{leave.days_requested !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)' }}>
                                                Applied On
                                            </div>
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {new Date(leave.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'var(--text-transform-heading)' }}>
                                                Decided On
                                            </div>
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {leave.owner_action_at
                                                    ? new Date(leave.owner_action_at).toLocaleDateString()
                                                    : leave.manager_action_at
                                                        ? new Date(leave.manager_action_at).toLocaleDateString()
                                                        : '-'}
                                            </div>
                                        </div>
                                    </div>

                                    {leave.reason && (
                                        <div style={{
                                            padding: 'var(--space-sm) var(--space-md)',
                                            borderTop: 'var(--border-subtle)',
                                            fontSize: '0.85rem',
                                            color: 'var(--color-text-muted)'
                                        }}>
                                            <strong>Reason:</strong> {leave.reason}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push(`/c/${slug}/admin`)}
                    >
                        <ArrowLeft size={18} />
                        <span>Back to Command Center</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
