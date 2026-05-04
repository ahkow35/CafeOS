'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Timesheet, TimesheetStatus, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Clock, ChevronRight } from 'lucide-react';
import { formatMonthYear } from '@/lib/dateUtils';

type ProfileMini = Pick<User, 'full_name' | 'email' | 'phone_e164' | 'role' | 'hourly_rate'>;
type TimesheetWithProfile = Timesheet & { profile: ProfileMini };

const STATUS_BADGE: Record<TimesheetStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#6b7280' },
  submitted: { label: 'Awaiting Manager', color: '#d97706' },
  pending_owner: { label: 'Awaiting Owner', color: '#7c3aed' },
  approved: { label: 'Approved', color: '#16a34a' },
  rejected: { label: 'Rejected', color: '#dc2626' },
};

export default function AdminTimesheetsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheets, setTimesheets] = useState<TimesheetWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'submitted' | 'pending_owner' | 'approved' | 'rejected'>('submitted');

  const load = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch('/api/timesheets?scope=all');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json() as { timesheets: TimesheetWithProfile[] };
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
    if (profile && profile.role !== 'manager' && profile.role !== 'owner') { router.push('/'); return; }
    load();
  }, [user, profile, authLoading, load, router]);

  // Refetch when the admin returns to this tab — otherwise a part-timer's
  // resubmission (rejected → submitted) won't appear until a manual reload.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user, load]);

  const filtered = filter === 'all' ? timesheets : timesheets.filter(t => t.status === filter);

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
          <section className="section animate-in">
            <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginBottom: '0.75rem', padding: 0 }}>
              <ArrowLeft size={18} /> Back
            </button>
            <h1 className="page-title">Part-timer Timesheets</h1>
            <p className="page-subtitle">Review and approve submitted timesheets</p>
          </section>

          {/* Filter tabs */}
          <section className="section animate-in">
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {([
                ['submitted', 'Awaiting Mgr'],
                ['pending_owner', 'Awaiting Owner'],
                ['all', 'All'],
                ['approved', 'Approved'],
                ['rejected', 'Rejected'],
              ] as const).map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{
                    padding: '0.35rem 0.85rem', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                    border: filter === f ? 'none' : '1px solid #e5e7eb',
                    background: filter === f ? 'var(--color-primary, #1a1a2e)' : '#fff',
                    color: filter === f ? '#fff' : '#374151',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {fetchError ? (
              <div className="empty-state">
                <div className="empty-state-title" style={{ color: '#ef4444' }}>Failed to load timesheets</div>
                <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                <button className="btn btn-primary" onClick={load}>Try again</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><Clock size={40} /></div>
                <div className="empty-state-title">No timesheets</div>
                <p>None matching this filter</p>
              </div>
            ) : (
              filtered.map(ts => {
                const badge = STATUS_BADGE[ts.status];
                return (
                  <div key={ts.id} className="card mb-md" style={{ cursor: 'pointer' }}
                    onClick={() => router.push(`/admin/timesheets/${ts.id}`)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div className="stat-icon"><Clock size={22} /></div>
                        <div>
                          <div className="card-title">{ts.profile?.full_name ?? ts.profile?.email ?? 'Unknown'}</div>
                          <div className="card-subtitle">{formatMonthYear(ts.month_year)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 600, color: badge.color,
                          background: badge.color + '18', padding: '2px 8px', borderRadius: 999,
                        }}>{badge.label}</span>
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
    </>
  );
}
