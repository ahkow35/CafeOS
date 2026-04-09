'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Clock, ChevronRight } from 'lucide-react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthYear(monthYear: string) {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

type TimesheetWithUser = Timesheet & { profiles: Pick<User, 'full_name' | 'email'> };

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#6b7280' },
  submitted: { label: 'Submitted', color: '#d97706' },
  approved: { label: 'Approved', color: '#16a34a' },
  rejected: { label: 'Rejected', color: '#dc2626' },
};

export default function AdminTimesheetsPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheets, setTimesheets] = useState<TimesheetWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'submitted' | 'approved' | 'rejected'>('submitted');

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    if (profile && profile.role !== 'manager' && profile.role !== 'owner') { router.push('/'); return; }
    load();
  }, [user, profile, authLoading]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('timesheets')
      .select('*, profiles(full_name, email)')
      .order('updated_at', { ascending: false });
    setTimesheets((data as TimesheetWithUser[]) ?? []);
    setLoading(false);
  }

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
              {(['submitted', 'all', 'approved', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{
                    padding: '0.35rem 0.85rem', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                    border: filter === f ? 'none' : '1px solid #e5e7eb',
                    background: filter === f ? 'var(--color-primary, #1a1a2e)' : '#fff',
                    color: filter === f ? '#fff' : '#374151',
                  }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
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
                          <div className="card-title">{ts.profiles?.full_name ?? ts.profiles?.email}</div>
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
