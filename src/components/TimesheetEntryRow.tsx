'use client';

import { fmt12, parseTimeInput, snapTo15, computeHours, isWeekend, isToday } from '@/lib/timeUtils';
import { MessageSquare, X } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Row state ────────────────────────────────────────────────────────────────

export interface RowState {
  startRaw: string;
  endRaw: string;
  startTime: string | null;
  endTime: string | null;
  breakHours: number;
  remarks: string;
  notesOpen: boolean;
  entryId: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TimesheetEntryRowProps {
  date: string;           // "YYYY-MM-DD"
  row: RowState;          // current row state for this date
  isDraft: boolean;       // whether timesheet is editable
  isSaving: boolean;      // true while this specific row is saving
  onRowChange: (date: string, updates: Partial<RowState>) => void;
  onBlur: (date: string, updatedRow: RowState) => void;  // triggers auto-save with latest row
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TimesheetEntryRow({
  date,
  row,
  isDraft,
  isSaving,
  onRowChange,
  onBlur,
}: TimesheetEntryRowProps) {
  function mergedRow(updates: Partial<RowState>): RowState {
    return { ...row, ...updates };
  }
  const d = new Date(date + 'T00:00:00');
  const dayNum = d.getDate();
  const dayName = DAYS[d.getDay()];
  const weekend = isWeekend(date);
  const today = isToday(date);

  const hrs = row.startTime && row.endTime
    ? computeHours(row.startTime, row.endTime, row.breakHours)
    : null;

  function handleTimeBlur(field: 'start' | 'end', rawValue: string) {
    let { startTime, endTime } = row;
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
    }

    const updates = { startRaw, endRaw, startTime, endTime };
    onRowChange(date, updates);
    onBlur(date, mergedRow(updates));
  }

  function handleBreakBlur(raw: string) {
    const val = parseFloat(raw) || 0;
    const snapped = Math.max(0, Math.round(val / 0.25) * 0.25);
    const updates = { breakHours: snapped };
    onRowChange(date, updates);
    onBlur(date, mergedRow(updates));
  }

  function handleClearTime(field: 'start' | 'end') {
    const updates = field === 'start'
      ? { startRaw: '', startTime: null as null }
      : { endRaw: '', endTime: null as null };
    onRowChange(date, updates);
    onBlur(date, mergedRow(updates));
  }

  return (
    <div
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
              onChange={e => onRowChange(date, { startRaw: e.target.value })}
              onBlur={e => handleTimeBlur('start', e.target.value)}
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
              onClick={() => handleClearTime('start')}
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
              onChange={e => onRowChange(date, { endRaw: e.target.value })}
              onBlur={e => handleTimeBlur('end', e.target.value)}
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
              onClick={() => handleClearTime('end')}
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
              onChange={e => onRowChange(date, { breakHours: parseFloat(e.target.value) || 0 })}
              onBlur={e => handleBreakBlur(e.target.value)}
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
            onClick={() => onRowChange(date, { notesOpen: !row.notesOpen })}
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
            onChange={e => onRowChange(date, { remarks: e.target.value })}
            onBlur={e => onBlur(date, { ...row, remarks: e.target.value })}
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
}
