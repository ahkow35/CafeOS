# Retrospective Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow all users (staff, manager, owner) to apply for leave with past dates within the current calendar year, going through the standard 2-level approval workflow.

**Architecture:** The apply form currently blocks past dates via `min={today}` on date inputs. We unlock this by setting `min` to Jan 1 of the current year and `max` to Dec 31. A new `is_retrospective` boolean column on `leave_requests` is set at insert time (when `start_date < today`). This flag drives a badge shown to approvers in `LeaveRequestCard`. All other logic (balance deduction, overlap detection, MC upload, approval routing) is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (PostgreSQL + RLS), TypeScript 5, Lucide React

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `supabase/migrations/006_retrospective_leave.sql` | Create | Adds `is_retrospective` boolean column to `leave_requests` |
| `src/lib/database.types.ts` | Modify | Adds `is_retrospective` field to Row / Insert / Update types |
| `src/app/leave/apply/page.tsx` | Modify | Unlocks past dates, adds year boundary validation, sets `is_retrospective` on insert, shows retrospective notice banner |
| `src/components/LeaveRequestCard.tsx` | Modify | Shows "Retrospective" badge when `is_retrospective` is true |

---

### Task 1: Database Migration — Add `is_retrospective` Column

**Files:**
- Create: `supabase/migrations/006_retrospective_leave.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 006: Retrospective Leave Support
-- Adds is_retrospective flag to leave_requests.
-- Existing rows default to false (all prior requests were forward-looking).

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS is_retrospective boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Apply the migration in Supabase**

Open Supabase Dashboard → SQL Editor, paste the migration SQL, and run it.

Expected: no errors, column appears in `leave_requests` table.

Verify with:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leave_requests' AND column_name = 'is_retrospective';
```
Expected output: one row — `is_retrospective | boolean | false`

- [ ] **Step 3: Commit the migration file**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add supabase/migrations/006_retrospective_leave.sql
git commit -m "feat: add is_retrospective column to leave_requests"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/lib/database.types.ts`

- [ ] **Step 1: Add `is_retrospective` to the `leave_requests` Row type**

Find the `Row` block inside `leave_requests` (around line 45–60). It currently ends with `updated_at: string;`. Add `is_retrospective` after `attachment_url`:

```typescript
// Before (line ~52):
        attachment_url: string | null;
        status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';

// After:
        attachment_url: string | null;
        is_retrospective: boolean;
        status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
```

- [ ] **Step 2: Add `is_retrospective` to the `leave_requests` Insert type**

Find the `Insert` block (around line 65–77). Add after `attachment_url`:

```typescript
// Before:
          attachment_url?: string | null;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';

// After:
          attachment_url?: string | null;
          is_retrospective?: boolean;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
```

- [ ] **Step 3: Add `is_retrospective` to the `leave_requests` Update type**

Find the `Update` block (around line 79–95). Add after `attachment_url`:

```typescript
// Before:
          attachment_url?: string | null;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';

// After:
          attachment_url?: string | null;
          is_retrospective?: boolean;
          status?: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/database.types.ts
git commit -m "feat: add is_retrospective to LeaveRequest TypeScript types"
```

---

### Task 3: Update Apply Form — Unlock Past Dates & Set Flag

**Files:**
- Modify: `src/app/leave/apply/page.tsx`

**Context:** The form currently sets `min={today}` on both date inputs (lines 292, 319), preventing past date selection. We need to:
1. Replace `today` with `yearStart` (Jan 1 of current year) as the minimum
2. Add `max={yearEnd}` (Dec 31 of current year) as the maximum
3. Show a contextual banner when selected dates are in the past
4. Set `is_retrospective: true` in the insert payload when `startDate < today`
5. Add a validation guard so users can't accidentally submit cross-year requests

- [ ] **Step 1: Update the date boundary constants (line ~218)**

Find:
```typescript
    const today = new Date().toISOString().split('T')[0];
```

Replace with:
```typescript
    const today = new Date().toISOString().split('T')[0];
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;
    const isRetrospective = !!startDate && startDate < today;
```

- [ ] **Step 2: Add a same-year validation guard in `handleSubmit`**

Find the existing date validation block (around line 75–83):
```typescript
        if (!startDate || !endDate) {
            setError('Please select both start and end dates');
            return;
        }

        if (daysRequested === 0) {
            setError('End date must be after start date');
            return;
        }
```

Add a year boundary check immediately after:
```typescript
        if (!startDate || !endDate) {
            setError('Please select both start and end dates');
            return;
        }

        if (daysRequested === 0) {
            setError('End date must be after start date');
            return;
        }

        if (new Date(startDate).getFullYear() !== currentYear || new Date(endDate).getFullYear() !== currentYear) {
            setError('Leave dates must fall within the current calendar year.');
            return;
        }
```

- [ ] **Step 3: Set `is_retrospective` in the insert payload**

Find the `.insert({...})` call (around line 166–180):
```typescript
            const { error: submitError } = await supabase
                .from('leave_requests')
                .insert({
                    user_id: user.id,
                    leave_type: leaveType,
                    start_date: startDate,
                    end_date: endDate,
                    days_requested: daysRequested,
                    status: initialStatus,
                    reason: leaveType === 'medical' ? reason : null,
                    attachment_url: attachmentUrl,
                    ...(profile?.role === 'owner' && {
                        owner_action_by: user.id,
                        owner_action_at: new Date().toISOString(),
                    }),
                });
```

Replace with:
```typescript
            const { error: submitError } = await supabase
                .from('leave_requests')
                .insert({
                    user_id: user.id,
                    leave_type: leaveType,
                    start_date: startDate,
                    end_date: endDate,
                    days_requested: daysRequested,
                    is_retrospective: startDate < today,
                    status: initialStatus,
                    reason: leaveType === 'medical' ? reason : null,
                    attachment_url: attachmentUrl,
                    ...(profile?.role === 'owner' && {
                        owner_action_by: user.id,
                        owner_action_at: new Date().toISOString(),
                    }),
                });
```

- [ ] **Step 4: Update the Start Date input — change `min`, add `max`**

Find (line ~291–293):
```typescript
                                    min={today}
                                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
```

Replace with:
```typescript
                                    min={yearStart}
                                    max={yearEnd}
                                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
```

- [ ] **Step 5: Update the End Date input — change `min`, add `max`**

Find (line ~318–320):
```typescript
                                    min={startDate || today}
                                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
```

Replace with:
```typescript
                                    min={startDate || yearStart}
                                    max={yearEnd}
                                    style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
```

- [ ] **Step 6: Add a retrospective notice banner below the Date Selection section**

Find the closing `</section>` of the Date Selection section (after the end date `</div></div></section>`, around line 323):
```typescript
                        </section>

                        {/* Medical Leave Extra Fields */}
```

Insert the banner between the date section and medical fields:
```tsx
                        </section>

                        {/* Retrospective Notice */}
                        {isRetrospective && (
                            <section className="section animate-in">
                                <div className="card" style={{ border: '2px solid var(--color-warning, #f59e0b)', background: 'var(--color-warning-light, #fffbeb)' }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                                        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>📅</span>
                                        <div>
                                            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Retrospective Request</div>
                                            <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                                                These dates are in the past. Your request will go through the standard approval process.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* Medical Leave Extra Fields */}
```

- [ ] **Step 7: Verify TypeScript compiles cleanly**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/leave/apply/page.tsx
git commit -m "feat: allow retrospective leave applications within current calendar year"
```

---

### Task 4: Show Retrospective Badge in LeaveRequestCard

**Files:**
- Modify: `src/components/LeaveRequestCard.tsx`

**Context:** `LeaveRequest` now has `is_retrospective: boolean`. When true, we show a small "Retrospective" badge alongside the leave type header so managers and owners can immediately identify these requests in the approval queue.

- [ ] **Step 1: Add the "Retrospective" badge to the card header**

Find the `leave-request-header` div (line ~70–82):
```tsx
            <div className="leave-request-header" style={{ paddingRight: onCancel ? '40px' : '0' }}>
                <div className="leave-request-type">
                    {request.leave_type === 'annual' ? (
                        <Palmtree size={20} className="leave-type-icon" />
                    ) : (
                        <Stethoscope size={20} className="leave-type-icon" />
                    )}
                    <span>{request.leave_type === 'annual' ? 'Annual Leave' : 'Medical Leave'}</span>
                </div>
                <span className={`badge ${statusDisplay.className}`}>
                    {statusDisplay.label}
                </span>
            </div>
```

Replace with:
```tsx
            <div className="leave-request-header" style={{ paddingRight: onCancel ? '40px' : '0' }}>
                <div className="leave-request-type">
                    {request.leave_type === 'annual' ? (
                        <Palmtree size={20} className="leave-type-icon" />
                    ) : (
                        <Stethoscope size={20} className="leave-type-icon" />
                    )}
                    <span>{request.leave_type === 'annual' ? 'Annual Leave' : 'Medical Leave'}</span>
                    {request.is_retrospective && (
                        <span className="badge badge-neutral" style={{ fontSize: '0.65rem', marginLeft: '0.25rem' }}>
                            Retrospective
                        </span>
                    )}
                </div>
                <span className={`badge ${statusDisplay.className}`}>
                    {statusDisplay.label}
                </span>
            </div>
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/LeaveRequestCard.tsx
git commit -m "feat: show Retrospective badge on leave request cards"
```

---

## Manual Smoke Test Checklist

After all tasks are complete, verify end-to-end in the browser:

- [ ] Open `/leave/apply` — start date picker allows selecting a past date (within current year)
- [ ] Select a past start date → retrospective notice banner appears
- [ ] Select a date from a previous year → form submission shows "Leave dates must fall within the current calendar year" error
- [ ] Submit a retrospective annual leave request → redirects to `/leave`, request shows "Retrospective" badge
- [ ] Submit a retrospective medical leave request (with reason + MC upload) → same as above
- [ ] As manager/owner, open `/admin/leave` → retrospective badge visible on pending request card
- [ ] Approve the request → balance deducted correctly, status moves through standard workflow
- [ ] Future leave (date after today) still works — no regressions
