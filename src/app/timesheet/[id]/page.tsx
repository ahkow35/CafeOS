'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, TimesheetEntry } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import SignatureModal from '@/components/SignatureModal';
import { ArrowLeft, Download, Send, Pencil, XCircle } from 'lucide-react';
import { fmt12, computeHours, getDaysInMonth } from '@/lib/timeUtils';
import TimesheetEntryRow, { RowState } from '@/components/TimesheetEntryRow';

const SHORT_MONTH = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ─── Row state ────────────────────────────────────────────────────────────────

function emptyRow(): RowState {
  return { startRaw: '', endRaw: '', startTime: null, endTime: null, breakHours: 0, remarks: '', notesOpen: false, entryId: null };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimesheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading } = useAuth();

  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [signModal, setSignModal] = useState(false);

  const isDraft = timesheet?.status === 'draft';

  const days = timesheet ? getDaysInMonth(timesheet.month_year) : [];

  const totalHours = days.reduce((sum, date) => {
    const row = rows[date];
    if (row?.startTime && row?.endTime) return sum + computeHours(row.startTime, row.endTime, row.breakHours);
    return sum;
  }, 0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: ts }, { data: ents }] = await Promise.all([
      supabase.from('timesheets').select('*').eq('id', id).single(),
      supabase.from('timesheet_entries').select('*').eq('timesheet_id', id),
    ]);
    if (!ts) { setLoading(false); return; }
    setTimesheet(ts as Timesheet);
    const map: Record<string, RowState> = {};
    for (const e of (ents ?? []) as TimesheetEntry[]) {
      map[e.entry_date] = {
        startRaw: e.start_time ? fmt12(e.start_time) : '',
        endRaw: e.end_time ? fmt12(e.end_time) : '',
        startTime: e.start_time,
        endTime: e.end_time,
        breakHours: e.break_hours,
        remarks: e.remarks ?? '',
        notesOpen: !!e.remarks,
        entryId: e.id,
      };
    }
    setRows(map);
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    load();
  }, [user, authLoading, load]);

  // ─── Save helpers ───────────────────────────────────────────────────────────

  async function saveRowData(
    date: string,
    data: Pick<RowState, 'startTime' | 'endTime' | 'breakHours' | 'remarks' | 'entryId'>
  ) {
    const { startTime, endTime, breakHours, remarks, entryId } = data;
    setSavingDate(date);

    if (!startTime && !endTime) {
      if (entryId) {
        await supabase.from('timesheet_entries').delete().eq('id', entryId);
        setRows(prev => ({ ...prev, [date]: { ...prev[date], entryId: null } }));
      }
      setSavingDate(null);
      return;
    }

    if (!startTime || !endTime) { setSavingDate(null); return; }

    const total_hours = computeHours(startTime, endTime, breakHours);

    if (entryId) {
      await supabase.from('timesheet_entries').update({
        start_time: startTime, end_time: endTime,
        break_hours: breakHours, total_hours,
        remarks: remarks || null,
      }).eq('id', entryId);
    } else {
      const { data: newEntry } = await supabase.from('timesheet_entries').insert({
        timesheet_id: id, entry_date: date,
        start_time: startTime, end_time: endTime,
        break_hours: breakHours, total_hours,
        remarks: remarks || null,
      }).select().single();
      if (newEntry) {
        setRows(prev => ({ ...prev, [date]: { ...prev[date], entryId: (newEntry as TimesheetEntry).id } }));
      }
    }

    setSavingDate(null);
  }

  // ─── Row handlers ───────────────────────────────────────────────────────────

  function handleRowChange(date: string, updates: Partial<RowState>) {
    setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), ...updates } }));
  }

  function handleRowBlur(date: string, updatedRow: RowState) {
    if (isDraft) saveRowData(date, updatedRow);
  }

  // ─── Submit / sign ──────────────────────────────────────────────────────────

  async function handleSign(dataUrl: string) {
    if (!timesheet) return;
    const { error: err } = await supabase
      .from('timesheets')
      .update({ employee_signature: dataUrl })
      .eq('id', timesheet.id);
    if (err) { setError(err.message); return; }
    setTimesheet(prev => prev ? { ...prev, employee_signature: dataUrl } : prev);
    setSignModal(false);
  }

  async function submitTimesheet() {
    if (!timesheet) return;
    setSubmitting(true);
    setError('');
    // .select() forces RLS violations to surface as 0 rows rather than a
    // silent no-op. Without this, an RLS block would leave the DB row
    // unchanged while the UI optimistically reports success.
    const { data, error: err } = await supabase
      .from('timesheets')
      .update({ status: 'submitted' })
      .eq('id', timesheet.id)
      .select();
    if (err) { setError(err.message); setSubmitting(false); return; }
    if (!data || data.length === 0) {
      setError('Could not submit — permission denied. Please reload and try again.');
      setSubmitting(false);
      return;
    }
    setTimesheet(prev => prev ? { ...prev, status: 'submitted' } : prev);
    setSubmitting(false);
  }

  async function reopenTimesheet() {
    if (!timesheet) return;
    setReopening(true);
    setError('');
    const { data, error: err } = await supabase
      .from('timesheets')
      .update({ status: 'draft', rejection_reason: null, employee_signature: null })
      .eq('id', timesheet.id)
      .select();
    if (err) { setError(err.message); setReopening(false); return; }
    if (!data || data.length === 0) {
      setError('Could not reopen — permission denied. Please reload and try again.');
      setReopening(false);
      return;
    }
    setTimesheet(prev => prev ? { ...prev, status: 'draft', rejection_reason: null, employee_signature: null } : prev);
    setReopening(false);
  }

  async function exportExcel() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch(`/api/timesheets/${id}/export`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${profile?.full_name?.replace(/\s+/g, '-') ?? 'me'}-${timesheet?.month_year ?? id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed. Try again.');
    }
    setExporting(false);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

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

  const [y, mo] = timesheet.month_year.split('-').map(Number);
  const monthLabel = `${SHORT_MONTH[mo - 1]} ${y}`;

  const STATUS_COLORS: Record<string, string> = {
    draft: 'var(--color-gray)',
    submitted: 'var(--color-orange)',
    approved: 'var(--color-stali-green)',
    rejected: 'var(--color-rust)',
  };

  return (
    <>
      <Header />
      <main className="page" style={{ paddingBottom: 120 }}>

        {/* ── Dark header ── */}
        <div style={{
          background: 'var(--color-gray-dark)', color: 'var(--color-white)',
          padding: 'var(--space-lg) var(--space-md)',
        }}>
          <button
            onClick={() => router.back()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray)', marginBottom: 'var(--space-md)', padding: 0, fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)' }}
          >
            <ArrowLeft size={16} /> BACK
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xl)', color: 'var(--color-white)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
                {profile?.full_name ?? ''}
              </h1>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray)', marginBottom: 'var(--space-md)' }}>
                {monthLabel}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                  Total Hours
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-2xl)', color: 'var(--color-neon)', lineHeight: 1 }}>
                  {totalHours % 1 === 0 ? totalHours.toFixed(0) : totalHours.toFixed(2)}
                </div>
              </div>
            </div>

            <span style={{
              fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              color: STATUS_COLORS[timesheet.status],
              border: `1px solid ${STATUS_COLORS[timesheet.status]}`,
              padding: '3px 8px', whiteSpace: 'nowrap',
            }}>
              {timesheet.status}
            </span>
          </div>
        </div>

        <div className="container">

          {/* ── Rejection notice ── */}
          {timesheet.status === 'rejected' && timesheet.rejection_reason && (
            <div className="section animate-in" style={{ marginTop: 'var(--space-lg)' }}>
              <div style={{ background: 'var(--color-rust)', color: 'var(--color-white)', padding: 'var(--space-md)', borderLeft: '4px solid var(--color-black)' }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-sm)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <XCircle size={14} /> REJECTED
                </div>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-white)' }}>{timesheet.rejection_reason}</p>
                <button
                  onClick={reopenTimesheet}
                  disabled={reopening}
                  style={{
                    marginTop: 'var(--space-sm)',
                    background: 'var(--color-white)',
                    color: 'var(--color-rust)',
                    border: '2px solid var(--color-white)',
                    padding: '6px 14px',
                    fontFamily: 'var(--font-heading)',
                    fontSize: 'var(--font-size-xs)',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                  }}
                >
                  {reopening ? 'REOPENING...' : 'REOPEN TO EDIT'}
                </button>
              </div>
            </div>
          )}

          {/* ── Day grid ── */}
          <div className="section animate-in" style={{ marginTop: 'var(--space-lg)', overflowX: 'auto' }}>

            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '44px 1fr 1fr 52px 44px 28px',
              gap: 4, paddingBottom: 6,
              borderBottom: '2px solid var(--color-black)',
            }}>
              {['DATE', 'IN', 'OUT', 'BRK', 'HRS', ''].map((col, i) => (
                <div key={i} style={{
                  fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-gray)', textTransform: 'uppercase', letterSpacing: '0.05em',
                  textAlign: i >= 3 ? 'center' : 'left',
                }}>{col}</div>
              ))}
            </div>

            {/* Day rows */}
            {days.map(date => (
              <TimesheetEntryRow
                key={date}
                date={date}
                row={rows[date] ?? emptyRow()}
                isDraft={isDraft}
                isSaving={savingDate === date}
                onRowChange={handleRowChange}
                onBlur={handleRowBlur}
              />
            ))}
          </div>

          {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>{error}</p>}

          {/* ── Download (submitted / approved) ── */}
          {(timesheet.status === 'submitted' || timesheet.status === 'approved') && (
            <div className="section animate-in">
              <button
                onClick={exportExcel}
                disabled={exporting}
                className="btn btn-outline btn-block"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Download size={16} />
                {exporting ? 'EXPORTING...' : 'DOWNLOAD TIMESHEET'}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* ── Fixed bottom action bar (draft only) ── */}
      {isDraft && (
        <div style={{
          position: 'fixed', bottom: 'var(--bottom-nav-height)', left: 0, right: 0,
          background: 'var(--color-white)', borderTop: '2px solid var(--color-black)',
          padding: 'var(--space-sm) var(--space-md)',
          display: 'flex', gap: 'var(--space-sm)', zIndex: 90,
          maxWidth: 'var(--max-width)', margin: '0 auto',
        }}>
          <button
            onClick={() => setSignModal(true)}
            className="btn btn-outline"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }}
          >
            <Pencil size={14} />
            {timesheet.employee_signature ? 'RE-SIGN' : 'SIGN'}
          </button>
          <button
            onClick={submitTimesheet}
            disabled={submitting || !timesheet.employee_signature}
            className="btn btn-primary"
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, fontSize: 'var(--font-size-xs)' }}
          >
            <Send size={14} />
            {submitting ? 'SUBMITTING...' : 'NEED MANAGER SIGN-OFF'}
          </button>
        </div>
      )}

      <BottomNav />

      {signModal && (
        <SignatureModal
          title="Employee Signature"
          onConfirm={handleSign}
          onClose={() => setSignModal(false)}
        />
      )}
    </>
  );
}
