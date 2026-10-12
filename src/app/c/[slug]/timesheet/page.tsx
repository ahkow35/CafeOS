'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Timesheet } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Clock, Plus, ChevronRight, FileText } from 'lucide-react';
import { formatMonthYear } from '@/lib/dateUtils';

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

// NOTE: these hex values are consumed as `badge.color + '18'` below to build an alpha-blended
// background tint at render time (string concatenation, not a CSS value) — CSS custom properties
// cannot be concatenated this way, so these stay raw hex per the task's "computed from data" carve-out.
function statusBadge(status: Timesheet['status']): { label: string; color: string } {
  switch (status) {
    case 'draft': return { label: 'Draft', color: '#6a6a66' };
    case 'submitted': return { label: 'Awaiting Manager', color: '#b45309' };
    case 'pending_owner': return { label: 'Awaiting Owner', color: '#6d28d9' };
    case 'approved': return { label: 'Approved', color: '#15803d' };
    case 'rejected': return { label: 'Declined', color: '#b91c1c' };
  }
}

export default function TimesheetPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const loadTimesheets = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await jsonOrError(await fetch('/api/timesheets?scope=mine')) as { timesheets: Timesheet[] };
      setTimesheets(data.timesheets ?? []);
    } catch (err) {
      console.error('Failed to load timesheets:', err);
      setFetchError('Failed to load timesheets. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    if (profile && profile.role !== 'part_timer') { router.push(`/c/${slug}/admin`); return; }
    loadTimesheets();
  }, [user, profile, authLoading, loadTimesheets, router]);

  if (authLoading || loading) {
    return (
      <>
        <Header />
        <main className="page"><div className="container"><div className="loading"><div className="spinner" /></div></div></main>
        <BottomNav />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <section className="page-header animate-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 className="page-title">My Timesheets</h1>
                <p className="page-subtitle">Track your working hours</p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setShowNewModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Plus size={18} /> New
              </button>
            </div>
          </section>

          <section className="section animate-in">
            {fetchError ? (
              <div className="empty-state">
                <div className="empty-state-title" style={{ color: 'var(--color-status-danger)' }}>Failed to load timesheets</div>
                <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                <button className="btn btn-primary" onClick={loadTimesheets}>Try again</button>
              </div>
            ) : timesheets.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><FileText size={48} /></div>
                <div className="empty-state-title">No timesheets yet</div>
                <p>Tap &quot;New&quot; to create your first timesheet</p>
              </div>
            ) : (
              timesheets.map(ts => {
                const badge = statusBadge(ts.status);
                return (
                  <div
                    key={ts.id}
                    className="card mb-md"
                    style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/c/${slug}/timesheet/${ts.id}`)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div className="stat-icon"><Clock size={22} /></div>
                        <div>
                          <div className="card-title">{formatMonthYear(ts.month_year)}</div>
                          {ts.rejection_reason && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-status-danger-strong)', marginTop: 2 }}>
                              Declined: {ts.rejection_reason}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 'var(--font-weight-semibold)',
                          color: badge.color,
                          background: badge.color + '18',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                        }}>
                          {badge.label}
                        </span>
                        <ChevronRight size={18} className="text-muted" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </main>
      <BottomNav />

      {showNewModal && (
        <NewTimesheetModal
          existingMonths={timesheets.map(t => t.month_year)}
          onClose={() => setShowNewModal(false)}
          onCreated={(ts) => {
            setTimesheets(prev => [ts, ...prev]);
            setShowNewModal(false);
            router.push(`/c/${slug}/timesheet/${ts.id}`);
          }}
        />
      )}
    </>
  );
}

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function NewTimesheetModal({
  existingMonths,
  onClose,
  onCreated,
}: {
  existingMonths: string[];
  onClose: () => void;
  onCreated: (ts: Timesheet) => void;
}) {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const monthYear = `${selectedYear}-${selectedMonth}`;

  const yearOptions = [
    String(now.getFullYear() - 1),
    String(now.getFullYear()),
    String(now.getFullYear() + 1),
  ];

  const selectStyle = {
    flex: 1,
    border: 'var(--border-width-thin) solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-8)',
    padding: '0.75rem',
    fontSize: '1rem',
    background: 'var(--color-white)',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
  };

  async function create() {
    if (existingMonths.includes(monthYear)) {
      setError('A timesheet for this month already exists.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const data = await jsonOrError(await fetch('/api/timesheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month_year: monthYear }),
      })) as { timesheet: Timesheet };
      onCreated(data.timesheet);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--color-overlay-scrim-light)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: 'var(--color-white)', width: '100%', borderRadius: 'var(--radius-sheet-top)', padding: '1.5rem', paddingBottom: 'calc(1.5rem + 80px)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontWeight: 'var(--font-weight-heading)', fontSize: '1.1rem', marginBottom: '1rem' }}>New Timesheet</h3>

        <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>
          Select Month &amp; Year
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={selectStyle}>
            {MONTH_OPTIONS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} style={{ ...selectStyle, flex: '0 0 auto', width: 90 }}>
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {error && <p style={{ color: 'var(--color-status-danger-strong)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
          <button onClick={create} disabled={creating} className="btn btn-primary" style={{ flex: 1 }}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
