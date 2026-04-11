# Admin Delete Leave Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow owners to permanently delete leave records from both the archive page (approved/rejected) and the admin leave page (pending requests), with balance restoration for pending deletions.

**Architecture:** Two pages gain a `handleDelete` function and a trash button (owner-only). A Supabase migration adds the missing DELETE RLS policy. Pending deletions follow the same balance-first-then-record pattern established in `handleReject`. Archive deletions are pure record removal with no balance side-effects.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase JS v2, TypeScript 5, Lucide React

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `supabase/migrations/007_owner_delete_policy.sql` | Create | Adds DELETE RLS policy for owners on `leave_requests` |
| `src/app/admin/archive/page.tsx` | Modify | Adds `handleDelete`, trash button per card (owner only), `Trash2` + `useToast` imports |
| `src/app/admin/leave/page.tsx` | Modify | Adds `handleDelete` with balance restore + rollback, trash button below each `DecisionTicket` (owner only), `Trash2` import |

---

### Task 1: Add DELETE RLS Policy Migration

**Files:**
- Create: `supabase/migrations/007_owner_delete_policy.sql`

Without a DELETE policy, the Supabase client will silently succeed (RLS returns 0 rows deleted) or throw a permissions error. This migration must be applied before testing the delete buttons.

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 007: Allow owners to delete leave records
-- Managers cannot delete — owner-only action for record cleanup.

CREATE POLICY "Owners can delete leave requests" ON public.leave_requests
    FOR DELETE USING (public.is_owner());
```

Save to `supabase/migrations/007_owner_delete_policy.sql`.

- [ ] **Step 2: Apply in Supabase Dashboard**

Open Supabase Dashboard → SQL Editor, paste the SQL above, and run it.

Verify:
```sql
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'leave_requests' AND cmd = 'DELETE';
```
Expected: one row — `Owners can delete leave requests | DELETE`

- [ ] **Step 3: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add supabase/migrations/007_owner_delete_policy.sql
git commit -m "feat: add owner DELETE RLS policy for leave_requests"
```

---

### Task 2: Delete on Archive Page (Approved/Rejected Records)

**Files:**
- Modify: `src/app/admin/archive/page.tsx`

**Context:** The archive page shows approved and rejected records. Both manager and owner can view it, but only owner can delete. Deleting here is pure record cleanup — no balance changes (approved leave was taken; rejected leave already had balance restored at rejection time).

- [ ] **Step 1: Read the file**

Read `src/app/admin/archive/page.tsx` in full before making any edits.

- [ ] **Step 2: Add `Trash2` to the lucide import and add `useToast` import**

Find:
```typescript
import { ArrowLeft, Calendar, CheckCircle, XCircle, Clock } from 'lucide-react';
```

Replace with:
```typescript
import { ArrowLeft, Calendar, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react';
```

Find:
```typescript
import { useAuth } from '@/context/AuthContext';
```

Replace with:
```typescript
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
```

- [ ] **Step 3: Add `isOwner` derived value and `toast` hook**

Find the existing state declarations block. After:
```typescript
    const [filter, setFilter] = useState<'all' | 'approved' | 'rejected'>('all');
```

Add:
```typescript
    const isOwner = profile?.role === 'owner';
    const toast = useToast();
```

- [ ] **Step 4: Add `handleDelete` function**

Add this function after `fetchLeaveHistory`:

```typescript
    const handleDelete = async (leaveId: string) => {
        if (!confirm('Permanently delete this leave record? This cannot be undone.')) return;

        // Optimistic removal
        setLeaves(prev => prev.filter(l => l.id !== leaveId));

        const { error } = await supabase
            .from('leave_requests')
            .delete()
            .eq('id', leaveId);

        if (error) {
            toast(`Failed to delete record: ${error.message}`, 'error');
            fetchLeaveHistory(); // revert optimistic removal
        }
    };
```

- [ ] **Step 5: Add trash button to each card**

Find the `card-header` div inside the `filteredLeaves.map(...)` — it currently renders the status badge on the right:

```tsx
                                    <div className="card-header" style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}>
                                        <div>
                                            <div className="card-title" style={{
                                                fontFamily: 'var(--font-heading)',
                                                textTransform: 'uppercase'
                                            }}>
                                                {leave.profiles?.full_name || 'Unknown User'}
                                            </div>
                                            <div className="card-subtitle" style={{ fontSize: '0.75rem' }}>
                                                {leave.profiles?.role} • {leave.leave_type === 'annual' ? '🏖️ Annual' : '🏥 Medical'}
                                            </div>
                                        </div>
                                        {getStatusBadge(leave.status)}
                                    </div>
```

Replace with:

```tsx
                                    <div className="card-header" style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start'
                                    }}>
                                        <div>
                                            <div className="card-title" style={{
                                                fontFamily: 'var(--font-heading)',
                                                textTransform: 'uppercase'
                                            }}>
                                                {leave.profiles?.full_name || 'Unknown User'}
                                            </div>
                                            <div className="card-subtitle" style={{ fontSize: '0.75rem' }}>
                                                {leave.profiles?.role} • {leave.leave_type === 'annual' ? '🏖️ Annual' : '🏥 Medical'}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            {getStatusBadge(leave.status)}
                                            {isOwner && (
                                                <button
                                                    onClick={() => handleDelete(leave.id)}
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--color-danger)', padding: '4px 8px' }}
                                                    title="Delete record"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/app/admin/archive/page.tsx
git commit -m "feat: add owner-only delete button to leave archive records"
```

---

### Task 3: Delete on Admin Leave Page (Pending Records)

**Files:**
- Modify: `src/app/admin/leave/page.tsx`

**Context:** The admin leave page shows pending requests. Owners see `DecisionTicket` components. When an owner deletes a pending request, the employee's balance must be restored first (it was deducted at submission time), then the record is deleted. If the delete fails, the balance restore is rolled back. Follows the same balance-first-then-record pattern from `handleReject`.

- [ ] **Step 1: Read the file**

Read `src/app/admin/leave/page.tsx` in full before making any edits.

- [ ] **Step 2: Add `Trash2` to the lucide import**

Find:
```typescript
import { CheckCircle, ArrowLeft } from 'lucide-react';
```

Replace with:
```typescript
import { CheckCircle, ArrowLeft, Trash2 } from 'lucide-react';
```

- [ ] **Step 3: Add `handleDelete` function**

Add this function after `handleReject` and before the `pageTitle` constant:

```typescript
    const handleDelete = async (request: LeaveRequestWithProfile) => {
        if (!currentUser) return;

        const confirmMessage = `Delete this pending request? ${request.days_requested} day${request.days_requested !== 1 ? 's' : ''} will be returned to ${request.profiles?.full_name || 'the employee'}'s ${request.leave_type} leave balance.`;
        if (!confirm(confirmMessage)) return;

        setProcessing(request.id);

        try {
            // Optimistic UI
            setRequests(prev => prev.filter(r => r.id !== request.id));

            // 1. Restore balance FIRST — abort if this fails (record untouched)
            const requestUser = request.profiles;
            if (requestUser) {
                const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                const currentBalance = (requestUser as any)[balanceField] ?? 0;
                const { error: balanceError } = await supabase
                    .from('profiles')
                    .update({ [balanceField]: currentBalance + request.days_requested })
                    .eq('id', request.user_id);

                if (balanceError) {
                    throw new Error(`Balance restore failed: ${balanceError.message}`);
                }
            }

            // 2. Delete the record — balance is already safe
            const { error: deleteError } = await supabase
                .from('leave_requests')
                .delete()
                .eq('id', request.id);

            if (deleteError) {
                // Roll back balance restore
                if (requestUser) {
                    const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                    const originalBalance = (requestUser as any)[balanceField] ?? 0;
                    await supabase
                        .from('profiles')
                        .update({ [balanceField]: originalBalance })
                        .eq('id', request.user_id);
                }
                throw deleteError;
            }

            await fetchLeavesOnly();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'An error occurred';
            toast(`Error: ${errorMessage}`, 'error');
            await fetchLeavesOnly();
        } finally {
            setProcessing(null);
        }
    };
```

- [ ] **Step 4: Add delete button below each DecisionTicket**

Find the render block inside `requests.map(request => {...})`. It currently looks like:

```tsx
                                    <div key={request.id} style={{ opacity: processing === request.id ? 0.5 : 1 }}>
                                        {isOwner ? (
                                            <DecisionTicket
                                                request={request}
                                                userName={displayName}
                                                onApprove={() => handleApprove(request)}
                                                onReject={() => handleReject(request)}
                                                processing={processing === request.id}
                                            />
                                        ) : (
                                            <LeaveRequestCard
                                                request={request}
                                                userName={displayName}
                                                showActions={true}
                                                onApprove={() => handleApprove(request)}
                                                onReject={() => handleReject(request)}
                                            />
                                        )}
                                    </div>
```

Replace with:

```tsx
                                    <div key={request.id} style={{ opacity: processing === request.id ? 0.5 : 1 }}>
                                        {isOwner ? (
                                            <>
                                                <DecisionTicket
                                                    request={request}
                                                    userName={displayName}
                                                    onApprove={() => handleApprove(request)}
                                                    onReject={() => handleReject(request)}
                                                    processing={processing === request.id}
                                                />
                                                <button
                                                    onClick={() => handleDelete(request)}
                                                    className="btn btn-ghost btn-sm btn-block"
                                                    style={{
                                                        color: 'var(--color-danger)',
                                                        marginTop: '-0.75rem',
                                                        marginBottom: 'var(--spacing-lg)',
                                                        fontSize: '0.8rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        gap: '0.4rem',
                                                    }}
                                                    disabled={!!processing}
                                                >
                                                    <Trash2 size={14} />
                                                    <span>Delete Record</span>
                                                </button>
                                            </>
                                        ) : (
                                            <LeaveRequestCard
                                                request={request}
                                                userName={displayName}
                                                showActions={true}
                                                onApprove={() => handleApprove(request)}
                                                onReject={() => handleReject(request)}
                                            />
                                        )}
                                    </div>
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/app/admin/leave/page.tsx
git commit -m "feat: add owner-only delete for pending leave requests with balance restore"
```

---

## Manual Smoke Test Checklist

After all tasks and after applying the migration in Supabase:

- [ ] As **owner**, open `/admin/archive` — trash icon appears on every record card
- [ ] As **manager**, open `/admin/archive` — trash icon is NOT visible
- [ ] As owner, click trash on an approved record → confirm dialog appears → record disappears, no balance change
- [ ] As owner, click trash on a rejected record → same as above
- [ ] As owner, open `/admin/leave` — "Delete Record" button appears below each DecisionTicket
- [ ] As owner, delete a pending request → confirm dialog shows the days and employee name → record removed → employee's balance restored
- [ ] Cancel the confirm dialog → nothing happens
- [ ] As **manager**, open `/admin/leave` — no Delete Record button visible (managers see LeaveRequestCard, not DecisionTicket)
