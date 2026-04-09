'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Timesheet, TimesheetEntry } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import SignatureModal from '@/components/SignatureModal';
import { ArrowLeft, MessageSquare, Download, Send, Pencil, X, XCircle } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTH = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ─── Time helpers ────────────────────────────────────────────────────────────

function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  // "9:30am" / "9:30pm"
  let m = s.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3] === 'am' && h === 12) h = 0;
    if (m[3] === 'pm' && h !== 12) h += 12;
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  // "9am" / "9pm"
  m = s.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]);
    if (m[2] === 'am' && h === 12) h = 0;
    if (m[2] === 'pm' && h !== 12) h += 12;
    if (h < 24) return `${String(h).padStart(2,'0')}:00`;
  }

  // "9:30" / "13:30" 24h
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]), min = parseInt(m[2]);
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  // "0930" / "930" / "2130"
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const padded = m[1].padStart(4, '0');
    const h = parseInt(padded.slice(0,2)), min = parseInt(padded.slice(2));
    if (h < 24 && min < 60) return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }

  return null;
}

function snapTo15(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let snapped = Math.round(m / 15) * 15;
  let hour = h;
  if (snapped === 60) { snapped = 0; hour = (h + 1) % 24; }
  return `${String(hour).padStart(2,'0')}:${String(snapped).padStart(2,'0')}`;
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

function computeHours(start: string, end: string, brk: number): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  const rounded = Math.round((mins / 60) / 0.25) * 0.25;
  return Math.max(0, rounded - brk);
}

function getDaysInMonth(monthYear: string): string[] {
  const [y, m] = monthYear.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
  );
}

function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  return dow === 0 || dow === 6;
}

function isToday(dateStr: string): boolean {
  return new Date().toISOString().slice(0,10) === dateStr;
}

// ─── Row state ────────────────────────────────────────────────────────────────

interface RowState {
  startRaw: string;
  endRaw: string;
  startTime: string | null;
  endTime: string | null;
  breakHours: number;
  remarks: string;
  notesOpen: boolean;
  entryId: string | null;
}

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

  // ─── Event handlers ─────────────────────────────────────────────────────────

  function handleTimeBlur(date: string, field: 'start' | 'end', rawValue: string) {
    const row = rows[date] ?? emptyRow();
    let { startTime, endTime, breakHours, remarks, entryId } = row;
    let startRaw = row.startRaw;
    let endRaw = row.endRaw;

    if (!rawValue.trim()) {
      if (field === 'start') { startTime = null; startRaw = ''; }
      else { endTime = null; endRaw = ''; }
    } else {
      const parsed = parseTimeInput(rawValue);
      if (parsed) {
        const snapped = snapTo15(parsed);
        const display = fmt12(snapped);
        if (field === 'start') { startTime = snapped; startRaw = display; }
        else { endTime = snapped; endRaw = display; }
      }
      // If unparseable, leave value as-is
    }

    setRows(prev => ({
      ...prev,
      [date]: { ...(prev[date] ?? emptyRow()), startRaw, endRaw, startTime, endTime },
    }));

    if (isDraft) saveRowData(date, { startTime, endTime, breakHours, remarks, entryId });
  }

  function handleBreakBlur(date: string, raw: string) {
    const row = rows[date] ?? emptyRow();
    const val = parseFloat(raw) || 0;
    const snapped = Math.max(0, Math.round(val / 0.25) * 0.25);
    setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), breakHours: snapped } }));
    if (isDraft) saveRowData(date, { ...row, breakHours: snapped });
  }

  function handleRemarksBlur(date: string) {
    const row = rows[date] ?? emptyRow();
    if (isDraft) saveRowData(date, row);
  }

  function clearTime(date: string, field: 'start' | 'end') {
    const row = rows[date] ?? emptyRow();
    const updates = field === 'start'
      ? { startRaw: '', startTime: null as null }
      : { endRaw: '', endTime: null as null };
    const updated = { ...row, ...updates };
    setRows(prev => ({ ...prev, [date]: updated }));
    if (isDraft) saveRowData(date, updated);
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
    const { error: err } = await supabase
      .from('timesheets')
      .update({ status: 'submitted' })
      .eq('id', timesheet.id);
    if (err) { setError(err.message); setSubmitting(false); return; }
    setTimesheet(prev => prev ? { ...prev, status: 'submitted' } : prev);
    setSubmitting(false);
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
            {days.map(date => {
              const d = new Date(date + 'T00:00:00');
              const dayNum = d.getDate();
              const dayName = DAYS[d.getDay()];
              const weekend = isWeekend(date);
              const today = isToday(date);
              const row = rows[date] ?? emptyRow();
              const hrs = row.startTime && row.endTime
                ? computeHours(row.startTime, row.endTime, row.breakHours)
                : null;
              const isSaving = savingDate === date;

              return (
                <div
                  key={date}
                  style={{
                    borderBottom: '1px solid var(--color-concrete)',
                    borderLeft: today ? '3px solid var(--color-orange)' : '3px solid transparent',
                  }}
                >
                  {/* Main row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr 1fr 52px 44px 28px',
                    gap: 4, alignItems: 'center',
                    padding: '6px 0',
                    background: weekend ? 'var(--color-concrete)' : 'transparent',
                  }}>

                    {/* DATE */}
                    <div style={{ paddingLeft: 4 }}>
                      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--font-size-base)', fontWeight: 700, lineHeight: 1.1 }}>{dayNum}</div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', color: weekend ? 'var(--color-orange)' : 'var(--color-gray)' }}>{dayName}</div>
                    </div>

                    {/* IN */}
                    <div style={{ position: 'relative' }}>
                      {isDraft ? (
                        <input
                          type="text"
                          value={row.startRaw}
                          onChange={e => setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), startRaw: e.target.value } }))}
                          onBlur={e => handleTimeBlur(date, 'start', e.target.value)}
                          placeholder="—"
                          style={{
                            width: '100%', border: '1px solid var(--color-black)',
                            padding: row.startRaw ? '4px 22px 4px 6px' : '4px 6px',
                            fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)',
                            background: 'var(--color-white)', borderRadius: 0,
                          }}
                        />
                      ) : (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', paddingLeft: 4, color: row.startTime ? 'var(--color-text)' : 'var(--color-gray)' }}>
                          {row.startTime ? fmt12(row.startTime) : '—'}
                        </span>
                      )}
                      {isDraft && row.startRaw && (
                        <button
                          onClick={() => clearTime(date, 'start')}
                          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-gray)', lineHeight: 1 }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>

                    {/* OUT */}
                    <div style={{ position: 'relative' }}>
                      {isDraft ? (
                        <input
                          type="text"
                          value={row.endRaw}
                          onChange={e => setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), endRaw: e.target.value } }))}
                          onBlur={e => handleTimeBlur(date, 'end', e.target.value)}
                          placeholder="—"
                          style={{
                            width: '100%', border: '1px solid var(--color-black)',
                            padding: row.endRaw ? '4px 22px 4px 6px' : '4px 6px',
                            fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)',
                            background: 'var(--color-white)', borderRadius: 0,
                          }}
                        />
                      ) : (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', paddingLeft: 4, color: row.endTime ? 'var(--color-text)' : 'var(--color-gray)' }}>
                          {row.endTime ? fmt12(row.endTime) : '—'}
                        </span>
                      )}
                      {isDraft && row.endRaw && (
                        <button
                          onClick={() => clearTime(date, 'end')}
                          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-gray)', lineHeight: 1 }}
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>

                    {/* BRK */}
                    <div>
                      {isDraft ? (
                        <input
                          type="number"
                          min={0} max={8} step={0.25}
                          value={row.breakHours}
                          onChange={e => setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), breakHours: parseFloat(e.target.value) || 0 } }))}
                          onBlur={e => handleBreakBlur(date, e.target.value)}
                          style={{
                            width: '100%', border: '1px solid var(--color-black)',
                            padding: '4px 2px', fontFamily: 'var(--font-body)',
                            fontSize: 'var(--font-size-xs)', textAlign: 'center',
                            background: 'var(--color-white)', borderRadius: 0,
                          }}
                        />
                      ) : (
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', display: 'block', textAlign: 'center', color: row.breakHours > 0 ? 'var(--color-text)' : 'var(--color-gray)' }}>
                          {row.breakHours > 0 ? row.breakHours : '0'}
                        </span>
                      )}
                    </div>

                    {/* HRS */}
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)', fontWeight: 700, color: hrs !== null ? 'var(--color-text)' : 'var(--color-gray)' }}>
                        {hrs !== null ? (hrs % 1 === 0 ? hrs.toFixed(0) : hrs.toFixed(2)) : '—'}
                      </span>
                      {isSaving && (
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-orange)', margin: '2px auto 0' }} />
                      )}
                    </div>

                    {/* Notes icon */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button
                        onClick={() => setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), notesOpen: !(prev[date]?.notesOpen) } }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: row.remarks ? 'var(--color-orange)' : 'var(--color-gray)', lineHeight: 1 }}
                      >
                        <MessageSquare size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Notes inline row */}
                  {row.notesOpen && (
                    <div style={{ padding: '0 0 6px', background: weekend ? 'var(--color-concrete)' : 'transparent' }}>
                      <input
                        type="text"
                        value={row.remarks}
                        onChange={e => setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), remarks: e.target.value } }))}
                        onBlur={() => handleRemarksBlur(date)}
                        placeholder="Add a note for this day..."
                        readOnly={!isDraft}
                        style={{
                          width: '100%', border: 'none', borderTop: '1px solid var(--color-concrete)',
                          padding: '6px 8px', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-gray)', background: 'transparent', borderRadius: 0,
                          outline: 'none',
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
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
