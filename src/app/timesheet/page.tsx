'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Clock, Plus, ChevronRight, FileText } from 'lucide-react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

function statusBadge(status: Timesheet['status']): { label: string; color: string } {
  switch (status) {
    case 'draft': return { label: 'Draft', color: '#6b7280' };
    case 'submitted': return { label: 'Submitted', color: '#d97706' };
    case 'approved': return { label: 'Approved', color: '#16a34a' };
    case 'rejected': return { label: 'Rejected', color: '#dc2626' };
  }
}

export default function TimesheetPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    if (profile && profile.role !== 'part_timer') { router.push('/'); return; }
    loadTimesheets();
  }, [user, profile, authLoading]);

  async function loadTimesheets() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('timesheets')
      .select('*')
      .eq('user_id', user.id)
      .order('month_year', { ascending: false });
    setTimesheets((data as Timesheet[]) ?? []);
    setLoading(false);
  }

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
            {timesheets.length === 0 ? (
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
                    onClick={() => router.push(`/timesheet/${ts.id}`)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div className="stat-icon"><Clock size={22} /></div>
                        <div>
                          <div className="card-title">{formatMonthYear(ts.month_year)}</div>
                          {ts.rejection_reason && (
                            <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: 2 }}>
                              Rejected: {ts.rejection_reason}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: badge.color,
                          background: badge.color + '18',
                          padding: '2px 8px',
                          borderRadius: 999,
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
          userId={user!.id}
          existingMonths={timesheets.map(t => t.month_year)}
          onClose={() => setShowNewModal(false)}
          onCreated={(ts) => {
            setTimesheets(prev => [ts, ...prev]);
            setShowNewModal(false);
            router.push(`/timesheet/${ts.id}`);
          }}
        />
      )}
    </>
  );
}

function NewTimesheetModal({
  userId,
  existingMonths,
  onClose,
  onCreated,
}: {
  userId: string;
  existingMonths: string[];
  onClose: () => void;
  onCreated: (ts: Timesheet) => void;
}) {
  const supabase = createClient();
  const [monthYear, setMonthYear] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Default to current month
  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    setMonthYear(`${y}-${m}`);
  }, []);

  async function create() {
    if (!monthYear) return;
    if (existingMonths.includes(monthYear)) {
      setError('A timesheet for this month already exists.');
      return;
    }
    setCreating(true);
    setError('');
    const { data, error: err } = await supabase
      .from('timesheets')
      .insert({ user_id: userId, month_year: monthYear })
      .select()
      .single();
    setCreating(false);
    if (err || !data) { setError(err?.message ?? 'Failed to create'); return; }
    onCreated(data as Timesheet);
  }

  return (
    <div className="fixed inset-0" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: '#fff', width: '100%', borderRadius: '1rem 1rem 0 0', padding: '1.5rem' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>New Timesheet</h3>

        <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>
          Select Month
        </label>
        <input
          type="month"
          value={monthYear}
          onChange={e => setMonthYear(e.target.value)}
          style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.75rem', fontSize: '1rem', marginBottom: '1rem' }}
        />

        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
          <button onClick={create} disabled={creating || !monthYear} className="btn btn-primary" style={{ flex: 1 }}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
