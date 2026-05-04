'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Timesheet, TimesheetEntry, TimesheetStatus } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import SignatureModal from '@/components/SignatureModal';
import { ArrowLeft, Download, Send, Pencil, XCircle } from 'lucide-react';
import { fmt12, computeHours, getDaysInMonth } from '@/lib/timeUtils';
import TimesheetEntryRow, { RowState } from '@/components/TimesheetEntryRow';

const SHORT_MONTH = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

async function jsonOrError<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
      ? (body as { error: string }).error
      : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function emptyRow(): RowState {
  return { startRaw: '', endRaw: '', startTime: null, endTime: null, breakHours: 0, remarks: '', notesOpen: false, entryId: null };
}

export default function TimesheetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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
    setLoading(true);
    try {
      const data = await jsonOrError<{ timesheet: Timesheet; entries: TimesheetEntry[] }>(
        await fetch(`/api/timesheets/${id}`),
      );
      setTimesheet(data.timesheet);
      const map: Record<string, RowState> = {};
      for (const e of data.entries ?? []) {
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
    } catch (err) {
      console.error('Failed to load timesheet:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/login'); return; }
    load();
  }, [user, authLoading, load, router]);

  async function saveRowData(
    date: string,
    data: Pick<RowState, 'startTime' | 'endTime' | 'breakHours' | 'remarks' | 'entryId'>
  ) {
    const { startTime, endTime, breakHours, remarks, entryId } = data;
    setSavingDate(date);

    try {
      if (!startTime && !endTime) {
        if (entryId) {
          await jsonOrError(await fetch(`/api/timesheet-entries/${entryId}`, { method: 'DELETE' }));
          setRows(prev => ({ ...prev, [date]: { ...prev[date], entryId: null } }));
        }
        return;
      }

      if (!startTime || !endTime) return;

      const total_hours = computeHours(startTime, endTime, breakHours);

      if (entryId) {
        await jsonOrError(await fetch(`/api/timesheet-entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_time: startTime,
            end_time: endTime,
            break_hours: breakHours,
            total_hours,
            remarks: remarks || null,
          }),
        }));
      } else {
        const created = await jsonOrError<{ entry: TimesheetEntry }>(await fetch(`/api/timesheets/${id}/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entry_date: date,
            start_time: startTime,
            end_time: endTime,
            break_hours: breakHours,
            total_hours,
            remarks: remarks || null,
          }),
        }));
        setRows(prev => ({ ...prev, [date]: { ...prev[date], entryId: created.entry.id } }));
      }
    } catch (err) {
      console.error('Failed to save row:', err);
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSavingDate(null);
    }
  }

  function handleRowChange(date: string, updates: Partial<RowState>) {
    setRows(prev => ({ ...prev, [date]: { ...(prev[date] ?? emptyRow()), ...updates } }));
  }

  function handleRowBlur(date: string, updatedRow: RowState) {
    if (isDraft) saveRowData(date, updatedRow);
  }

  async function patchTimesheet(body: Record<string, unknown>) {
    return jsonOrError<{ timesheet: Timesheet }>(await fetch(`/api/timesheets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }

  async function handleSign(dataUrl: string) {
    if (!timesheet) return;
    try {
      const { timesheet: updated } = await patchTimesheet({ employee_signature: dataUrl });
      setTimesheet(updated);
      setSignModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save signature');
    }
  }

  async function submitTimesheet() {
    if (!timesheet) return;
    setSubmitting(true);
    setError('');
    try {
      const { timesheet: updated } = await patchTimesheet({ status: 'submitted' });
      setTimesheet(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  async function reopenTimesheet() {
    if (!timesheet) return;
    setReopening(true);
    setError('');
    try {
      const { timesheet: updated } = await patchTimesheet({ status: 'draft' });
      setTimesheet(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen');
    } finally {
      setReopening(false);
    }
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
    } finally {
      setExporting(false);
    }
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

  const [y, mo] = timesheet.month_year.split('-').map(Number);
  const monthLabel = `${SHORT_MONTH[mo - 1]} ${y}`;

  const STATUS_META: Record<TimesheetStatus, { color: string; label: string }> = {
    draft:         { color: 'var(--color-gray)',         label: 'draft' },
    submitted:     { color: 'var(--color-orange)',       label: 'awaiting manager' },
    pending_owner: { color: '#a78bfa',                   label: 'awaiting owner' },
    approved:      { color: 'var(--color-stali-green)',  label: 'approved' },
    rejected:      { color: 'var(--color-rust)',         label: 'rejected' },
  };
  const statusMeta = STATUS_META[timesheet.status];

  return (
    <>
      <Header />
      <main className="page" style={{ paddingBottom: 120 }}>

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
              color: statusMeta.color,
              border: `1px solid ${statusMeta.color}`,
              padding: '3px 8px', whiteSpace: 'nowrap',
            }}>
              {statusMeta.label}
            </span>
          </div>
        </div>

        <div className="container">

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

          <div className="section animate-in" style={{ marginTop: 'var(--space-lg)', overflowX: 'auto' }}>

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

          {(timesheet.status === 'submitted' || timesheet.status === 'pending_owner' || timesheet.status === 'approved') && (
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
