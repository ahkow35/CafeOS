# Phase 2 & 3 Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 393 inline styles, replace JS hover manipulation with CSS, consolidate duplicated utilities, and break 3 god files (645/577/491 lines) into focused components.

**Architecture:** Phase 2 creates shared utilities and CSS classes first, so Phase 3 component splits can import them cleanly. Each task is independently shippable and deployable. No new dependencies.

**Tech Stack:** Next.js 16, TypeScript, React 19, globals.css (CSS variables, no Tailwind), Supabase, Lucide icons.

---

## File Map

### Created
- `src/lib/timeUtils.ts` — time parsing/formatting helpers (extracted from 3 files)
- `src/lib/dateUtils.ts` — date formatting helpers (extracted from 4 files)
- `src/components/TimesheetEntryRow.tsx` — single row in the timesheet grid
- `src/components/LeaveApplicationForm.tsx` — the leave application form (moved from page)
- `src/components/TeamMemberCard.tsx` — single team member card with actions

### Modified (Phase 2)
- `src/app/globals.css` — add `.decision-btn`, `.decision-btn-reject`, `.decision-btn-approve` classes
- `src/components/DecisionTicket.tsx` — remove onMouseEnter/Leave JS, use CSS classes, fix broken CSS var references
- `src/components/LeaveBalanceCard.tsx` — remove onMouseEnter/Leave JS (`.stat-card:hover` in globals.css already handles it)
- `src/components/PendingApprovalsWidget.tsx` — replace hardcoded `#16a34a` / `#ef4444` hex with CSS variables

### Modified (Phase 3)
- `src/app/timesheet/[id]/page.tsx` — import from timeUtils, import TimesheetEntryRow, remove extracted code
- `src/app/leave/apply/page.tsx` — thin wrapper that imports LeaveApplicationForm
- `src/app/admin/team/page.tsx` — import TeamMemberCard, remove extracted code

---

## Task 1: Create `src/lib/timeUtils.ts`

**Files:**
- Create: `src/lib/timeUtils.ts`

These 7 functions are currently copy-pasted across `src/app/timesheet/[id]/page.tsx` (lines 18–97), `src/app/admin/timesheets/[id]/page.tsx`, and `src/app/api/timesheets/[id]/export/route.ts`. Extract them once.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/timeUtils.ts

/**
 * Parse flexible user time input into HH:MM (24h).
 * Accepts: "9:30am", "9am", "9:30", "13:30", "0930", "930"
 * Returns null if unrecognised.
 */
export function parseTimeInput(raw: string): string | null {
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

/** Snap HH:MM to the nearest 15-minute interval. */
export function snapTo15(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  let snapped = Math.round(m / 15) * 15;
  let hour = h;
  if (snapped === 60) { snapped = 0; hour = (h + 1) % 24; }
  return `${String(hour).padStart(2,'0')}:${String(snapped).padStart(2,'0')}`;
}

/** Format HH:MM (24h) as "9:30 AM" / "1:00 PM". */
export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${period}`;
}

/**
 * Compute net hours worked (rounded to nearest 0.25h).
 * Handles overnight shifts. Break is subtracted in hours.
 */
export function computeHours(start: string, end: string, brk: number): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  const rounded = Math.round((mins / 60) / 0.25) * 0.25;
  return Math.max(0, rounded - brk);
}

/** Return all YYYY-MM-DD strings for every day in a "YYYY-MM" month. */
export function getDaysInMonth(monthYear: string): string[] {
  const [y, m] = monthYear.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
  );
}

/** True if the date string (YYYY-MM-DD) falls on Saturday or Sunday. */
export function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  return dow === 0 || dow === 6;
}

/** True if the date string (YYYY-MM-DD) is today's local date. */
export function isToday(dateStr: string): boolean {
  return new Date().toISOString().slice(0,10) === dateStr;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timeUtils.ts
git commit -m "feat: extract time utility functions to src/lib/timeUtils.ts"
```

---

## Task 2: Create `src/lib/dateUtils.ts`

**Files:**
- Create: `src/lib/dateUtils.ts`

Date formatting is duplicated across `LeaveRequestCard.tsx`, `DecisionTicket.tsx`, `timesheet/page.tsx`, and `admin/timesheets/[id]/page.tsx`. Extract into one place.

- [ ] **Step 1: Create the file**

```typescript
// src/lib/dateUtils.ts

const SHORT_MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MONTH  = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Format "YYYY-MM-DD" → "15 Jan 2026" (used in DecisionTicket, approval screens).
 */
export function formatDateLong(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  return `${date.getDate().toString().padStart(2,'0')} ${SHORT_MONTH[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format "YYYY-MM-DD" → "Jan 15" (used in LeaveRequestCard).
 */
export function formatDateShort(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  return `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format "YYYY-MM" → "Jan 2026" (used in timesheet list pages).
 */
export function formatMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${SHORT_MONTH[parseInt(month) - 1]} ${year}`;
}

/**
 * Format "YYYY-MM" → "January 2026" (used in timesheet detail header).
 */
export function formatMonthYearLong(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${LONG_MONTH[parseInt(month) - 1]} ${year}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dateUtils.ts
git commit -m "feat: extract date utility functions to src/lib/dateUtils.ts"
```

---

## Task 3: Add decision button CSS classes to globals.css

**Files:**
- Modify: `src/app/globals.css`

`DecisionTicket.tsx` has two buttons (REJECT, APPROVE) with full inline styles AND manual `onMouseEnter`/`onMouseLeave` JS hover handlers. Move all of that to CSS.

Also: DecisionTicket references `--color-neon-orange` and `--color-neon-green` which don't exist in the design system. The correct variables are `--color-orange` (#FF5500) and `--color-neon` (#CCFF00).

- [ ] **Step 1: Add CSS classes at the end of globals.css, before the closing `@media` block**

Open `src/app/globals.css` and add the following block before `/* ==================== Responsive ==================== */`:

```css
/* ==================== Decision Ticket Buttons ==================== */
.decision-btn {
  padding: var(--space-md);
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  cursor: pointer;
  border: 2px solid var(--color-black);
  transition: all 0.1s ease;
  width: 100%;
}

.decision-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.decision-btn-reject {
  background: var(--color-white);
  color: var(--color-black);
}

.decision-btn-reject:hover:not(:disabled) {
  background: var(--color-black);
  color: var(--color-orange);
}

.decision-btn-approve {
  background: var(--color-black);
  color: var(--color-white);
}

.decision-btn-approve:hover:not(:disabled) {
  background: var(--color-white);
  color: var(--color-black);
  box-shadow: inset 0 0 0 2px var(--color-neon);
  border-color: var(--color-neon);
}
```

- [ ] **Step 2: Verify no CSS syntax errors by running the build check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors (CSS errors would appear as build failures).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add decision-btn CSS classes to replace JS hover manipulation"
```

---

## Task 4: Fix `DecisionTicket.tsx`

**Files:**
- Modify: `src/components/DecisionTicket.tsx`

Remove all `onMouseEnter`/`onMouseLeave` handlers from the two action buttons. Replace inline styles on the buttons with the CSS classes added in Task 3. Fix the broken CSS variable references (`--color-neon-orange` → `--color-orange`, `--color-neon-green` → `--color-neon`).

Also use `formatDateLong` from dateUtils instead of the inline `formatDate` function.

- [ ] **Step 1: Read the current file**

Read `src/components/DecisionTicket.tsx` fully before editing.

- [ ] **Step 2: Rewrite the file**

```tsx
'use client';

import { LeaveRequest } from '@/lib/database.types';
import { formatDateLong } from '@/lib/dateUtils';
import { FileText, Calendar } from 'lucide-react';

interface DecisionTicketProps {
    request: LeaveRequest;
    userName?: string;
    onApprove: () => void;
    onReject: () => void;
    processing: boolean;
}

export default function DecisionTicket({
    request,
    userName,
    onApprove,
    onReject,
    processing
}: DecisionTicketProps) {
    const isMedical = request.leave_type === 'medical';

    return (
        <div className="card" style={{ padding: 0, marginBottom: 'var(--space-lg)' }}>
            {/* Header */}
            <div style={{
                background: 'var(--color-black)',
                color: 'var(--color-white)',
                padding: 'var(--space-sm) var(--space-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-heading)',
                textTransform: 'uppercase',
                letterSpacing: '1px'
            }}>
                <span>TICKET #{request.id.slice(0, 6)}</span>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                    {request.is_retrospective && (
                        <span style={{
                            background: 'var(--color-warning)',
                            color: 'var(--color-black)',
                            padding: '2px 8px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                        }}>
                            RETRO
                        </span>
                    )}
                    <span style={{
                        background: isMedical ? 'var(--color-orange)' : 'var(--color-neon)',
                        color: 'var(--color-black)',
                        padding: '2px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                    }}>
                        {request.leave_type}
                    </span>
                </div>
            </div>

            {/* Body */}
            <div style={{ padding: 'var(--space-md)' }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-md)',
                    marginBottom: 'var(--space-md)'
                }}>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>REQUESTER</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{userName || 'Unknown'}</div>
                    </div>
                    <div>
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>DURATION</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{request.days_requested} DAYS</div>
                    </div>
                </div>

                <div style={{
                    borderTop: '2px solid var(--color-concrete)',
                    borderBottom: '2px solid var(--color-concrete)',
                    padding: 'var(--space-sm) 0',
                    marginBottom: 'var(--space-md)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-md)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-body)' }}>{formatDateLong(request.start_date)}</span>
                    </div>
                    <div className="text-muted">➡</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} />
                        <span style={{ fontFamily: 'var(--font-body)' }}>{formatDateLong(request.end_date)}</span>
                    </div>
                </div>

                {(request.reason || request.attachment_url) && (
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                        {request.reason && (
                            <div style={{ marginBottom: '0.5rem' }}>
                                <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}>REASON</div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>{request.reason}</div>
                            </div>
                        )}
                        {request.attachment_url && (
                            <a
                                href={request.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm"
                                style={{ textDecoration: 'none', marginTop: '0.5rem' }}
                            >
                                <FileText size={14} />
                                VIEW PROOF
                            </a>
                        )}
                    </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                    <button
                        onClick={onReject}
                        disabled={processing}
                        className="decision-btn decision-btn-reject"
                    >
                        REJECT
                    </button>
                    <button
                        onClick={onApprove}
                        disabled={processing}
                        className="decision-btn decision-btn-approve"
                    >
                        APPROVE
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DecisionTicket.tsx
git commit -m "refactor: replace JS hover manipulation in DecisionTicket with CSS classes"
```

---

## Task 5: Fix `LeaveBalanceCard.tsx`

**Files:**
- Modify: `src/components/LeaveBalanceCard.tsx`

The `.stat-card:hover` CSS in `globals.css` (lines 484–488) already handles the hover effect (translate + shadow). The JS `handleMouseEnter`/`handleMouseLeave` functions are redundant AND they use a different effect (scale + rgba shadow) that conflicts with the design system's brutalist hover style.

Remove the JS handlers. Remove the inline `transition` style on the card divs (`.stat-card` already has it). The `border: '2px solid black'` inline is also redundant — `.stat-card` has the border via `.card`. Keep only layout-specific inline styles.

- [ ] **Step 1: Read the current file**

Read `src/components/LeaveBalanceCard.tsx` fully before editing.

- [ ] **Step 2: Rewrite the file**

```tsx
'use client';

import Link from 'next/link';

interface LeaveBalanceCardProps {
    annualBalance: number;
    medicalBalance: number;
}

export default function LeaveBalanceCard({ annualBalance, medicalBalance }: LeaveBalanceCardProps) {
    return (
        <div className="stats-grid">
            <Link href="/leave/apply?type=annual" style={{ textDecoration: 'none' }}>
                <div className="stat-card" style={{ cursor: 'pointer' }}>
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
                        Annual Leave
                    </div>
                    <div className="stat-value" style={{
                        background: 'var(--color-black)',
                        color: 'var(--color-neon)',
                        fontSize: '3rem',
                        padding: '1rem',
                        display: 'inline-block',
                        width: '100%',
                        fontFamily: 'var(--font-heading)'
                    }}>
                        {annualBalance}
                    </div>
                </div>
            </Link>
            <Link href="/leave/apply?type=medical" style={{ textDecoration: 'none' }}>
                <div className="stat-card" style={{ cursor: 'pointer' }}>
                    <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
                        Medical Leave
                    </div>
                    <div className="stat-value" style={{
                        background: 'var(--color-black)',
                        color: 'var(--color-white)',
                        fontSize: '3rem',
                        padding: '1rem',
                        display: 'inline-block',
                        width: '100%',
                        fontFamily: 'var(--font-heading)'
                    }}>
                        {medicalBalance}
                    </div>
                </div>
            </Link>
        </div>
    );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/LeaveBalanceCard.tsx
git commit -m "refactor: remove JS hover handlers from LeaveBalanceCard, use CSS stat-card:hover"
```

---

## Task 6: Fix hardcoded colors in `PendingApprovalsWidget.tsx`

**Files:**
- Modify: `src/components/PendingApprovalsWidget.tsx`

The widget uses `backgroundColor: '#16a34a'` (approve green) and `backgroundColor: '#ef4444'` (reject red) hardcoded inline. These should use CSS variables from the design system.

- [ ] **Step 1: Read the full file**

Read `src/components/PendingApprovalsWidget.tsx` in full. Note every location of hardcoded hex colors.

- [ ] **Step 2: Replace hardcoded colors**

Search for every instance of `'#16a34a'` and `'#ef4444'` and `'#ef'` and similar raw hex values. Replace:
- `'#16a34a'` → `'var(--color-stali-green)'`
- `'#ef4444'` → `'var(--color-rust)'`

Use the Edit tool to make targeted replacements. Run a grep after to confirm no hex colors remain in this file:

```bash
grep -n "#[0-9a-fA-F]\{6\}" /Users/nyanyk/Antigravity/CafeOS/src/components/PendingApprovalsWidget.tsx
```

Expected: no output (no hex colors left).

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PendingApprovalsWidget.tsx
git commit -m "refactor: replace hardcoded hex colors in PendingApprovalsWidget with CSS variables"
```

---

## Task 7: Update `timesheet/page.tsx` and `admin/timesheets/page.tsx` to use `dateUtils`

**Files:**
- Modify: `src/app/timesheet/page.tsx`
- Modify: `src/app/admin/timesheets/page.tsx`

Both files define a local `formatMonthYear` function. Delete those and import from `src/lib/dateUtils.ts`.

- [ ] **Step 1: Update `src/app/timesheet/page.tsx`**

Delete lines 14–17 (the `formatMonthYear` function definition):
```typescript
function formatMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-');
  return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
}
```

Also delete the `MONTH_NAMES` constant on line 12.

Add import at top of file (after existing imports):
```typescript
import { formatMonthYear } from '@/lib/dateUtils';
```

- [ ] **Step 2: Update `src/app/admin/timesheets/page.tsx`**

Same change — delete the local `formatMonthYear` function and `MONTH_NAMES` constant, add the import.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/timesheet/page.tsx src/app/admin/timesheets/page.tsx
git commit -m "refactor: use shared dateUtils.formatMonthYear in timesheet list pages"
```

---

## Task 8: Create `src/components/TimesheetEntryRow.tsx`

**Files:**
- Create: `src/components/TimesheetEntryRow.tsx`
- Modify: `src/app/timesheet/[id]/page.tsx`

`timesheet/[id]/page.tsx` is 645 lines. The largest single block is the per-day row rendering logic (~180 lines of JSX starting around line 290). Extract it into `<TimesheetEntryRow />`.

- [ ] **Step 1: Read `src/app/timesheet/[id]/page.tsx` in full**

Read the file in three chunks:
- Lines 1–200 (helpers + state)
- Lines 200–400 (save logic + row handlers)
- Lines 400–645 (JSX rendering)

Identify exactly which lines form the per-row JSX that should become `<TimesheetEntryRow />`.

- [ ] **Step 2: Define the props interface**

The row component needs:

```typescript
interface TimesheetEntryRowProps {
  date: string;              // "YYYY-MM-DD"
  row: RowState;             // current row state
  isDraft: boolean;          // whether timesheet is editable
  isSaving: boolean;         // true while this specific row is being saved
  onRowChange: (date: string, updates: Partial<RowState>) => void;
  onBlur: (date: string) => void;  // triggers save
}
```

`RowState` is already defined in the page file — re-export it or move it to a shared types location if needed.

- [ ] **Step 3: Create `src/components/TimesheetEntryRow.tsx`**

Move the per-row JSX from the page into this component. Import `fmt12`, `parseTimeInput`, `snapTo15`, `computeHours`, `isWeekend`, `isToday` from `@/lib/timeUtils`. Import the `RowState` type from the page (or define it here and export it).

The component renders one `<tr>` (or equivalent div row) with: date label, start/end time inputs, break selector, computed hours, remarks toggle, and saving indicator.

- [ ] **Step 4: Update `src/app/timesheet/[id]/page.tsx`**

- Remove the 7 time helper functions (lines 18–97) — now imported from `@/lib/timeUtils`
- Remove the inline per-row JSX — now rendered by `<TimesheetEntryRow />`
- Import `TimesheetEntryRow` from `@/components/TimesheetEntryRow`
- Import time utils from `@/lib/timeUtils`
- Pass the correct props to `<TimesheetEntryRow />`

Target: page file should be under 350 lines after extraction.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Test manually**

Navigate to a timesheet detail page. Confirm:
- All days render correctly
- Time inputs accept "9am", "9:30", "0930" formats
- Computed hours update on blur
- Saving indicator appears while row is being saved
- Remarks toggle works

- [ ] **Step 7: Commit**

```bash
git add src/components/TimesheetEntryRow.tsx src/app/timesheet/[id]/page.tsx
git commit -m "refactor: extract TimesheetEntryRow component and time utilities from timesheet detail page"
```

---

## Task 9: Create `src/components/LeaveApplicationForm.tsx`

**Files:**
- Create: `src/components/LeaveApplicationForm.tsx`
- Modify: `src/app/leave/apply/page.tsx`

`leave/apply/page.tsx` is 491 lines. The entire form is already inside a function named `LeaveApplicationForm()` — it just lives in the page file. The page exports a thin wrapper that wraps it in `<Suspense>`. Move `LeaveApplicationForm` to its own file.

- [ ] **Step 1: Read `src/app/leave/apply/page.tsx` in full**

Read all 491 lines. Note all imports that `LeaveApplicationForm` uses — they all need to move with it.

- [ ] **Step 2: Create `src/components/LeaveApplicationForm.tsx`**

Cut the entire `LeaveApplicationForm` function from the page file and paste it here. Move all imports it depends on. The component does not need any props — it reads everything from `useAuth()` and `useSearchParams()`.

```typescript
'use client';
// All the imports that LeaveApplicationForm needs
// ... (copy from page file)

export default function LeaveApplicationForm() {
    // ... entire existing function body
}
```

- [ ] **Step 3: Rewrite `src/app/leave/apply/page.tsx`**

After moving the form, the page file becomes:

```typescript
import { Suspense } from 'react';
import LeaveApplicationForm from '@/components/LeaveApplicationForm';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';

export default function LeaveApplyPage() {
    return (
        <>
            <Header />
            <Suspense fallback={
                <main className="page">
                    <div className="container">
                        <div className="loading" style={{ minHeight: '60vh' }}>
                            <div className="spinner" />
                        </div>
                    </div>
                </main>
            }>
                <LeaveApplicationForm />
            </Suspense>
            <BottomNav />
        </>
    );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Test manually**

Navigate to `/leave/apply`. Confirm:
- Form loads correctly
- Leave type pre-selects when URL has `?type=annual` or `?type=medical`
- Day count calculates correctly when dates are selected
- Balance warning shows when days exceed available balance
- Medical certificate upload works
- Form submits and redirects correctly

- [ ] **Step 6: Commit**

```bash
git add src/components/LeaveApplicationForm.tsx src/app/leave/apply/page.tsx
git commit -m "refactor: move LeaveApplicationForm to its own component file"
```

---

## Task 10: Create `src/components/TeamMemberCard.tsx`

**Files:**
- Create: `src/components/TeamMemberCard.tsx`
- Modify: `src/app/admin/team/page.tsx`

`admin/team/page.tsx` is 577 lines. The bulk of it is the per-member card rendering (~300 lines). Extract it into `<TeamMemberCard />`.

- [ ] **Step 1: Read `src/app/admin/team/page.tsx` in full**

Read all 577 lines in two chunks (lines 1–300, then 300–577). Identify the per-member rendering block and what data/callbacks it needs.

- [ ] **Step 2: Define the props interface**

```typescript
interface TeamMemberCardProps {
  member: User;
  currentUserRole: string;
  updating: string | null;            // ID of member being updated, or null
  onToggleActive: (id: string, isActive: boolean) => void;
  onChangeRole: (id: string, newRole: string) => void;
  onUpdateHourlyRate: (id: string, rate: number) => void;
  onDelete: (id: string, name: string) => void;
}
```

- [ ] **Step 3: Create `src/components/TeamMemberCard.tsx`**

Extract the per-member JSX from the page. It should render one staff card with: avatar initials, name/email, role badge, active status toggle, hourly rate editor (if part_timer), and delete button (if owner).

Import `User` from `@/lib/database.types`. Import any icons from `lucide-react` that are used in the card.

- [ ] **Step 4: Update `src/app/admin/team/page.tsx`**

Replace the inlined card JSX with `<TeamMemberCard ... />` calls. Import from `@/components/TeamMemberCard`.

Target: page file under 250 lines after extraction.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Test manually**

Navigate to `/admin/team`. Confirm:
- All team members render
- Toggle active/inactive works and toasts on success
- Role change works (owner only)
- Hourly rate edit works for part-timers
- Delete confirms and removes member

- [ ] **Step 7: Commit**

```bash
git add src/components/TeamMemberCard.tsx src/app/admin/team/page.tsx
git commit -m "refactor: extract TeamMemberCard component from admin team page"
```

---

## Task 11: Update timeUtils imports in `admin/timesheets/[id]/page.tsx` and export route

**Files:**
- Modify: `src/app/admin/timesheets/[id]/page.tsx`
- Modify: `src/app/api/timesheets/[id]/export/route.ts`

Both files copy-paste `fmt12` and other time helpers. Replace with imports from `src/lib/timeUtils`.

- [ ] **Step 1: Read both files**

Read `src/app/admin/timesheets/[id]/page.tsx` (top 80 lines) and `src/app/api/timesheets/[id]/export/route.ts` (top 60 lines). Note which helpers they define locally.

- [ ] **Step 2: Update `admin/timesheets/[id]/page.tsx`**

Delete any locally-defined `fmt12`, `formatMonthYear`, `formatDate`, `getDayName` functions. Add import:
```typescript
import { fmt12 } from '@/lib/timeUtils';
import { formatMonthYear, formatDateLong } from '@/lib/dateUtils';
```

Adjust call sites if function names differ.

- [ ] **Step 3: Update `src/app/api/timesheets/[id]/export/route.ts`**

Same — delete local `fmt12` and date helpers, import from the shared utils.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Test export**

Open a submitted timesheet and tap the Export button. Confirm the Excel file downloads and contains correct data.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/timesheets/[id]/page.tsx src/app/api/timesheets/[id]/export/route.ts
git commit -m "refactor: use shared timeUtils and dateUtils in admin timesheet pages"
```

---

## Task 12: Final deploy

- [ ] **Step 1: Full type check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 2: Confirm no rogue inline hex colors in touched components**

```bash
grep -rn "#[0-9a-fA-F]\{6\}" /Users/nyanyk/Antigravity/CafeOS/src/components/ --include="*.tsx"
```

Review any hits — inline hex is acceptable ONLY if it is in globals.css-derived utilities or intentionally not in the design system (e.g. signature canvas color). Flag any unexpected hits before merging.

- [ ] **Step 3: Push to main**

```bash
git push origin main
```

Vercel auto-deploys. Confirm the deploy completes successfully in Vercel dashboard.

---

## Self-Review Checklist

**Spec coverage:**
- [x] Inline `onMouseEnter`/`onMouseLeave` removed from DecisionTicket and LeaveBalanceCard → Tasks 3, 4, 5
- [x] Hardcoded hex colors replaced in PendingApprovalsWidget → Task 6
- [x] Broken CSS variable references fixed in DecisionTicket (`--color-neon-orange`, `--color-neon-green`) → Task 4
- [x] `fmt12`, `formatMonthYear` duplication across 3 files eliminated → Tasks 1, 2, 7, 11
- [x] timesheet/[id]/page.tsx reduced from 645 lines → Task 8
- [x] leave/apply/page.tsx reduced from 491 lines → Task 9
- [x] admin/team/page.tsx reduced from 577 lines → Task 10
- [x] TypeScript verified after each task → every task has `tsc --noEmit` step
- [x] Manual testing required for tasks that touch user-visible behaviour → Tasks 8, 9, 10, 11

**Type consistency:**
- `RowState` used in Task 8 is the same interface defined at top of `timesheet/[id]/page.tsx`
- `User` type imported from `@/lib/database.types` in Tasks 10, consistent with rest of codebase
- All utility functions exported as named exports, all imports use named import syntax

**Notes:**
- Tasks 1–7 are Phase 2 (style/utility). Tasks 8–12 are Phase 3 (god files).
- Tasks 1–7 can be executed in any order except Task 4 must come after Task 3 (CSS classes needed first).
- Tasks 8, 9, 10 are fully independent of each other and can be parallelised.
- Task 11 depends on Tasks 1 and 2 (timeUtils and dateUtils must exist first).
