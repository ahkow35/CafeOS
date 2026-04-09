'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, TimesheetEntry, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, CheckCircle, XCircle, Download } from 'lucide-react';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMonthYear(monthYear: string) {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function getDayName(dateStr: string) {
  return DAYS[new Date(dateStr + 'T00:00:00').getDay()];
}

type FullTimesheet = Timesheet & {
  profiles: Pick<User, 'full_name' | 'email' | 'phone' | 'hourly_rate'>;
};

export default function AdminTimesheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheet, setTimesheet] = useState<FullTimesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const totalHours = entries.reduce((sum, e) => sum + e.total_hours, 0);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ts }, { data: ents }] = await Promise.all([
      supabase.from('timesheets').select('*, profiles(full_name, email, phone, hourly_rate)').eq('id', id).single(),
      supabase.from('timesheet_entries').select('*').eq('timesheet_id', id).order('entry_date'),
    ]);
    setTimesheet(ts as FullTimesheet);
    setEntries((ents as TimesheetEntry[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    if (profile && profile.role !== 'manager' && profile.role !== 'owner') { router.push('/'); return; }
    load();
  }, [user, profile, authLoading, load]);

  async function approve() {
    if (!timesheet || !user) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('timesheets')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', timesheet.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setTimesheet(prev => prev ? { ...prev, status: 'approved' } : prev);
  }

  async function reject() {
    if (!timesheet || !rejectionReason.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('timesheets')
      .update({ status: 'rejected', rejection_reason: rejectionReason.trim() })
      .eq('id', timesheet.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setTimesheet(prev => prev ? { ...prev, status: 'rejected', rejection_reason: rejectionReason.trim() } : prev);
    setShowRejectModal(false);
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const res = await fetch(`/api/timesheets/${id}/export`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${timesheet?.profiles?.full_name?.replace(/\s+/g, '-') ?? id}-${timesheet?.month_year}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed. Try again.');
    }
    setExporting(false);
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

  if (!timesheet) return null;

  const isSubmitted = timesheet.status === 'submitted';
  const hourlyRate = timesheet.profiles?.hourly_rate;
  const salary = hourlyRate ? totalHours * hourlyRate : null;

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <section className="section animate-in">
            <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginBottom: '0.75rem', padding: 0 }}>
              <ArrowLeft size={18} /> Back
            </button>
            <h1 className="page-title">{timesheet.profiles?.full_name ?? timesheet.profiles?.email}</h1>
            <p className="page-subtitle">{formatMonthYear(timesheet.month_year)}</p>
            {timesheet.profiles?.phone && (
              <p className="page-subtitle">Contact: {timesheet.profiles.phone}</p>
            )}
          </section>

          {/* Salary preview */}
          {salary !== null && (
            <section className="section animate-in">
              <div className="card" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Salary Calculation</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#15803d' }}>
                  {totalHours.toFixed(2)} hrs × S${hourlyRate!.toFixed(2)}/hr = S${salary.toFixed(2)}
                </div>
              </div>
            </section>
          )}

          {!hourlyRate && (
            <section className="section animate-in">
              <div className="card" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                <p style={{ fontSize: '0.875rem', color: '#92400e' }}>
                  Hourly rate not set for this staff member. Set it in <strong>Manage Team</strong> to see salary calculation.
                </p>
              </div>
            </section>
          )}

          {/* Entries */}
          <section className="section animate-in">
            <h2 className="section-title">Timesheet Entries</h2>
            {entries.length === 0 ? (
              <div className="empty-state"><p>No entries submitted.</p></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Day</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>In</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Out</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Brk</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Hrs</th>
                      <th style={{ padding: '8px 6px', color: '#6b7280', fontWeight: 600 }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{formatDate(entry.entry_date)}</td>
                        <td style={{ padding: '8px 6px' }}>{getDayName(entry.entry_date)}</td>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{entry.start_time ?? '-'}</td>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{entry.end_time ?? '-'}</td>
                        <td style={{ padding: '8px 6px' }}>{entry.break_hours}</td>
                        <td style={{ padding: '8px 6px', fontWeight: 600 }}>{entry.total_hours}</td>
                        <td style={{ padding: '8px 6px', color: '#6b7280' }}>{entry.remarks ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                      <td colSpan={5} style={{ padding: '8px 6px', fontWeight: 700 }}>TOTAL</td>
                      <td style={{ padding: '8px 6px', fontWeight: 700, fontSize: '1rem' }}>{totalHours.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Rejection reason display */}
          {timesheet.status === 'rejected' && timesheet.rejection_reason && (
            <section className="section animate-in">
              <div className="card" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>Rejection Reason</div>
                <p style={{ fontSize: '0.9rem', color: '#7f1d1d' }}>{timesheet.rejection_reason}</p>
              </div>
            </section>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', padding: '0 1rem 0.5rem' }}>{error}</p>}

          {/* Actions */}
          <section className="section animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* Export always available if entries exist */}
            {entries.length > 0 && (
              <button onClick={exportExcel} disabled={exporting} className="btn btn-outline"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
                <Download size={18} />
                {exporting ? 'Exporting...' : 'Export Excel'}
              </button>
            )}

            {isSubmitted && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <button onClick={() => setShowRejectModal(true)} disabled={saving}
                  className="btn btn-outline"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: '#dc2626', color: '#dc2626' }}>
                  <XCircle size={18} /> Reject
                </button>
                <button onClick={approve} disabled={saving}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckCircle size={18} /> {saving ? '...' : 'Approve'}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
      <BottomNav />

      {showRejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }} onClick={() => setShowRejectModal(false)}>
          <div style={{ background: '#fff', width: '100%', borderRadius: '1rem 1rem 0 0', padding: '1.5rem' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>Reject Timesheet</h3>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 6 }}>Reason (required)</label>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="Explain why this timesheet is being rejected..."
              rows={3}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem', resize: 'none' }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button onClick={() => setShowRejectModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={reject} disabled={saving || !rejectionReason.trim()}
                className="btn btn-primary"
                style={{ flex: 1, background: '#dc2626', borderColor: '#dc2626' }}>
                {saving ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
