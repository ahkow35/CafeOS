'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, TimesheetEntry } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Plus, Trash2, Send, CheckCircle, XCircle } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BREAK_OPTIONS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatMonthYear(monthYear: string) {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function getDayName(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return DAYS[d.getDay()];
}

/** Round minutes to nearest 0.25h, compute total = (end - start) - break */
function computeTotal(startTime: string, endTime: string, breakHours: number): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let totalMins = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMins < 0) totalMins += 24 * 60; // overnight
  const rawHours = totalMins / 60;
  const rounded = Math.round(rawHours / 0.25) * 0.25;
  return Math.max(0, rounded - breakHours);
}

export default function TimesheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isDraft = timesheet?.status === 'draft';
  const totalHours = entries.reduce((sum, e) => sum + e.total_hours, 0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: ts }, { data: ents }] = await Promise.all([
      supabase.from('timesheets').select('*').eq('id', id).single(),
      supabase.from('timesheet_entries').select('*').eq('timesheet_id', id).order('entry_date'),
    ]);
    setTimesheet(ts as Timesheet);
    setEntries((ents as TimesheetEntry[]) ?? []);
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    load();
  }, [user, authLoading, load]);

  async function deleteEntry(entryId: string) {
    await supabase.from('timesheet_entries').delete().eq('id', entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
  }

  async function submitTimesheet() {
    if (!timesheet || entries.length === 0) return;
    setSubmitting(true);
    setError('');
    const { error: err } = await supabase
      .from('timesheets')
      .update({ status: 'submitted' })
      .eq('id', timesheet.id);
    if (err) { setError(err.message); setSubmitting(false); return; }
    setTimesheet(prev => prev ? { ...prev, status: 'submitted' } : prev);
    setSubmitting(false);
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

  const statusColors: Record<string, string> = {
    draft: '#6b7280', submitted: '#d97706', approved: '#16a34a', rejected: '#dc2626',
  };

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          {/* Back + Header */}
          <section className="section animate-in">
            <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', marginBottom: '0.75rem', padding: 0 }}>
              <ArrowLeft size={18} /> Back
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 className="page-title">{formatMonthYear(timesheet.month_year)}</h1>
                <p className="page-subtitle">{profile?.full_name}</p>
              </div>
              <span style={{
                fontSize: '0.75rem', fontWeight: 600,
                color: statusColors[timesheet.status],
                background: statusColors[timesheet.status] + '18',
                padding: '4px 10px', borderRadius: 999,
              }}>
                {timesheet.status.charAt(0).toUpperCase() + timesheet.status.slice(1)}
              </span>
            </div>

            {timesheet.status === 'rejected' && timesheet.rejection_reason && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem', marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#dc2626', fontWeight: 600, fontSize: '0.875rem' }}>
                  <XCircle size={16} /> Rejection Reason
                </div>
                <p style={{ fontSize: '0.875rem', color: '#7f1d1d', marginTop: 4 }}>{timesheet.rejection_reason}</p>
              </div>
            )}

            {timesheet.status === 'approved' && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.75rem', marginTop: '0.75rem' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#16a34a', fontWeight: 600, fontSize: '0.875rem' }}>
                  <CheckCircle size={16} /> Approved
                </div>
              </div>
            )}
          </section>

          {/* Entries table */}
          <section className="section animate-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 className="section-title" style={{ margin: 0 }}>Entries</h2>
              {isDraft && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}
                >
                  <Plus size={16} /> Add
                </button>
              )}
            </div>

            {entries.length === 0 ? (
              <div className="empty-state">
                <p>No entries yet. Add your working days.</p>
              </div>
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
                      {isDraft && <th style={{ padding: '8px 6px' }} />}
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
                        <td style={{ padding: '8px 6px', color: '#6b7280', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.remarks ?? ''}</td>
                        {isDraft && (
                          <td style={{ padding: '8px 6px' }}>
                            <button onClick={() => deleteEntry(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4 }}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                      <td colSpan={isDraft ? 5 : 5} style={{ padding: '8px 6px', fontWeight: 700, color: '#374151' }}>TOTAL</td>
                      <td style={{ padding: '8px 6px', fontWeight: 700, fontSize: '1rem' }}>{totalHours.toFixed(2)}</td>
                      <td colSpan={isDraft ? 2 : 1} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Comments */}
          {timesheet.comments && (
            <section className="section animate-in">
              <h2 className="section-title">Comments</h2>
              <div className="card"><p style={{ fontSize: '0.9rem' }}>{timesheet.comments}</p></div>
            </section>
          )}

          {/* Submit */}
          {isDraft && (
            <section className="section animate-in">
              {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', marginBottom: 8 }}>{error}</p>}
              <button
                onClick={submitTimesheet}
                disabled={submitting || entries.length === 0}
                className="btn btn-primary"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Send size={18} />
                {submitting ? 'Submitting...' : 'Submit Timesheet'}
              </button>
              {entries.length === 0 && (
                <p style={{ fontSize: '0.8rem', color: '#6b7280', textAlign: 'center', marginTop: 6 }}>Add at least one entry before submitting</p>
              )}
            </section>
          )}
        </div>
      </main>
      <BottomNav />

      {showAddModal && (
        <AddEntryModal
          timesheetId={timesheet.id}
          monthYear={timesheet.month_year}
          existingDates={entries.map(e => e.entry_date)}
          onClose={() => setShowAddModal(false)}
          onAdded={(entry) => {
            setEntries(prev => [...prev, entry].sort((a, b) => a.entry_date.localeCompare(b.entry_date)));
            setShowAddModal(false);
          }}
        />
      )}
    </>
  );
}

function AddEntryModal({
  timesheetId,
  monthYear,
  existingDates,
  onClose,
  onAdded,
}: {
  timesheetId: string;
  monthYear: string;
  existingDates: string[];
  onClose: () => void;
  onAdded: (entry: TimesheetEntry) => void;
}) {
  const supabase = createClient();
  const [entryDate, setEntryDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakHours, setBreakHours] = useState(0);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Default date to first of month
  useEffect(() => {
    const [y, m] = monthYear.split('-');
    setEntryDate(`${y}-${m}-01`);
  }, [monthYear]);

  const totalHours = startTime && endTime ? computeTotal(startTime, endTime, breakHours) : 0;

  async function save() {
    if (!entryDate || !startTime || !endTime) { setError('Date, start and end time are required.'); return; }
    if (existingDates.includes(entryDate)) { setError('An entry for this date already exists.'); return; }
    if (totalHours <= 0) { setError('Total hours must be greater than 0. Check times.'); return; }
    setSaving(true);
    setError('');
    const { data, error: err } = await supabase
      .from('timesheet_entries')
      .insert({
        timesheet_id: timesheetId,
        entry_date: entryDate,
        start_time: startTime,
        end_time: endTime,
        break_hours: breakHours,
        total_hours: totalHours,
        remarks: remarks || null,
      })
      .select()
      .single();
    setSaving(false);
    if (err || !data) { setError(err?.message ?? 'Failed to save'); return; }
    onAdded(data as TimesheetEntry);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: '#fff', width: '100%', borderRadius: '1rem 1rem 0 0', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1.25rem' }}>Add Entry</h3>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Date</label>
            <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Time In</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Time Out</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem' }} />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Break (hours)</label>
            <select value={breakHours} onChange={e => setBreakHours(parseFloat(e.target.value))}
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem', background: '#fff' }}>
              {BREAK_OPTIONS.map(b => <option key={b} value={b}>{b === 0 ? 'No break' : `${b}h`}</option>)}
            </select>
          </div>

          {startTime && endTime && (
            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Total Hours</span>
              <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{totalHours.toFixed(2)}</span>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#6b7280', marginBottom: 4 }}>Remarks (optional)</label>
            <input type="text" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. Cafe Shift"
              style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.625rem', fontSize: '1rem' }} />
          </div>
        </div>

        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', marginTop: '0.75rem' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button onClick={onClose} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ flex: 1 }}>
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
