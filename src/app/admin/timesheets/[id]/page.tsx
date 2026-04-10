'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, TimesheetEntry, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import SignatureModal from '@/components/SignatureModal';
import { ArrowLeft, CheckCircle, XCircle, Download, Pencil } from 'lucide-react';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
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
  const [showManagerSignModal, setShowManagerSignModal] = useState(false);

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

  async function handleManagerSign(dataUrl: string) {
    if (!timesheet) return;
    const { error: err } = await supabase
      .from('timesheets')
      .update({ manager_signature: dataUrl })
      .eq('id', timesheet.id);
    if (err) { setError(err.message); return; }
    setTimesheet(prev => prev ? { ...prev, manager_signature: dataUrl } : prev);
    setShowManagerSignModal(false);
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

          {/* Header */}
          <section className="section animate-in">
            <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray)', marginBottom: '0.75rem', padding: 0, fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)' }}>
              <ArrowLeft size={18} /> BACK
            </button>
            <h1 className="page-title">{timesheet.profiles?.full_name ?? timesheet.profiles?.email}</h1>
            <p className="page-subtitle">{formatMonthYear(timesheet.month_year)}</p>
            {timesheet.profiles?.phone && (
              <p className="page-subtitle">Contact: {timesheet.profiles.phone}</p>
            )}
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <span style={{
                display: 'inline-block',
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--font-size-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '3px 10px',
                border: '2px solid',
                borderColor: timesheet.status === 'approved' ? 'var(--color-success, #22c55e)' : timesheet.status === 'rejected' ? 'var(--color-rust)' : timesheet.status === 'submitted' ? 'var(--color-black)' : 'var(--color-gray)',
                color: timesheet.status === 'approved' ? 'var(--color-success, #22c55e)' : timesheet.status === 'rejected' ? 'var(--color-rust)' : timesheet.status === 'submitted' ? 'var(--color-black)' : 'var(--color-gray)',
                background: timesheet.status === 'submitted' ? 'var(--color-neon)' : 'transparent',
              }}>
                {timesheet.status.toUpperCase()}
              </span>
            </div>
          </section>

          {/* Salary preview */}
          {salary !== null && (
            <section className="section animate-in">
              <div className="card">
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Salary Calculation
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
                  {totalHours.toFixed(2)} hrs × S${hourlyRate!.toFixed(2)}/hr = S${salary.toFixed(2)}
                </div>
              </div>
            </section>
          )}

          {!hourlyRate && (
            <section className="section animate-in">
              <div className="card" style={{ borderColor: 'var(--color-gray)' }}>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray)' }}>
                  Hourly rate not set. Set it in <strong>Manage Team</strong> to see salary calculation.
                </p>
              </div>
            </section>
          )}

          {/* Entries table */}
          <section className="section animate-in">
            <h2 className="section-title">Timesheet Entries</h2>
            {entries.length === 0 ? (
              <div className="empty-state"><p>No entries submitted.</p></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-black)', textAlign: 'left' }}>
                      {['Date','Day','In','Out','Brk','Hrs','Remarks'].map(h => (
                        <th key={h} style={{ padding: '6px 4px', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid var(--color-concrete)' }}>
                        <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{formatDate(entry.entry_date)}</td>
                        <td style={{ padding: '6px 4px' }}>{getDayName(entry.entry_date)}</td>
                        <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{entry.start_time ? fmt12(entry.start_time) : '—'}</td>
                        <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{entry.end_time ? fmt12(entry.end_time) : '—'}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>{entry.break_hours}</td>
                        <td style={{ padding: '6px 4px', fontWeight: 700 }}>{entry.total_hours}</td>
                        <td style={{ padding: '6px 4px', color: 'var(--color-gray)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.remarks ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--color-black)' }}>
                      <td colSpan={5} style={{ padding: '6px 4px', fontFamily: 'var(--font-heading)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</td>
                      <td style={{ padding: '6px 4px', fontWeight: 700 }}>{totalHours.toFixed(2)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Signatures section */}
          <section className="section animate-in">
            <h2 className="section-title">Signatures</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>

              {/* Employee signature */}
              <div className="card" style={{ padding: 'var(--space-md)' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-sm)' }}>
                  Employee
                </div>
                {timesheet.employee_signature ? (
                  <img
                    src={timesheet.employee_signature}
                    alt="Employee signature"
                    style={{ width: '100%', border: '1px solid var(--color-concrete)', display: 'block' }}
                  />
                ) : (
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-concrete)', color: 'var(--color-gray)', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)' }}>
                    Not signed
                  </div>
                )}
              </div>

              {/* Manager signature */}
              <div className="card" style={{ padding: 'var(--space-md)' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-sm)' }}>
                  Manager
                </div>
                {timesheet.manager_signature ? (
                  <img
                    src={timesheet.manager_signature}
                    alt="Manager signature"
                    style={{ width: '100%', border: '1px solid var(--color-concrete)', display: 'block' }}
                  />
                ) : (
                  <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-concrete)', color: 'var(--color-gray)', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)' }}>
                    Not signed
                  </div>
                )}
                {isSubmitted && (
                  <button
                    onClick={() => setShowManagerSignModal(true)}
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: 'var(--space-sm)', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  >
                    <Pencil size={12} />
                    {timesheet.manager_signature ? 'RE-SIGN' : 'SIGN'}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Rejection reason */}
          {timesheet.status === 'rejected' && timesheet.rejection_reason && (
            <section className="section animate-in">
              <div className="card" style={{ borderColor: 'var(--color-rust)', borderLeftWidth: 6 }}>
                <div style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-rust)', marginBottom: 4, fontSize: 'var(--font-size-sm)', textTransform: 'uppercase' }}>
                  Rejection Reason
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)' }}>{timesheet.rejection_reason}</p>
              </div>
            </section>
          )}

          {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', padding: '0 0 0.5rem' }}>{error}</p>}

          {/* Actions */}
          <section className="section animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {entries.length > 0 && (
              <button onClick={exportExcel} disabled={exporting} className="btn btn-outline btn-block"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Download size={18} />
                {exporting ? 'EXPORTING...' : 'EXPORT EXCEL'}
              </button>
            )}

            {isSubmitted && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                <button onClick={() => setShowRejectModal(true)} disabled={saving}
                  className="btn btn-danger"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <XCircle size={16} /> REJECT
                </button>
                <button onClick={approve} disabled={saving}
                  className="btn btn-success"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckCircle size={16} /> {saving ? '...' : 'APPROVE'}
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
      <BottomNav />

      {/* Reject modal */}
      {showRejectModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 300 }}
          onClick={() => setShowRejectModal(false)}
        >
          <div
            style={{ background: 'var(--color-white)', width: '100%', borderTop: '3px solid var(--color-black)', padding: 'var(--space-lg)', paddingBottom: 'calc(var(--space-lg) + env(safe-area-inset-bottom, 0px))' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-sm)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Reject Timesheet
            </h3>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray)', marginBottom: 'var(--space-md)' }}>
              This will notify the employee. They can resubmit after correcting.
            </p>
            <label style={{ display: 'block', fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Reason (required)
            </label>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="e.g. Missing entries for 3rd and 5th, please correct and resubmit."
              rows={4}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                border: '2px solid var(--color-black)',
                padding: '10px 12px',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--font-size-sm)',
                resize: 'vertical',
                outline: 'none',
                marginBottom: 'var(--space-md)',
                background: 'var(--color-white)',
                color: 'var(--color-black)',
              }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button
                onClick={() => { setShowRejectModal(false); setRejectionReason(''); }}
                className="btn btn-outline"
                style={{ flex: 1 }}
              >
                CANCEL
              </button>
              <button
                onClick={reject}
                disabled={saving || !rejectionReason.trim()}
                className="btn btn-danger"
                style={{ flex: 1 }}
              >
                {saving ? 'REJECTING...' : 'CONFIRM REJECT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager signature modal */}
      {showManagerSignModal && (
        <SignatureModal
          title="Manager Signature"
          onConfirm={handleManagerSign}
          onClose={() => setShowManagerSignModal(false)}
        />
      )}
    </>
  );
}
