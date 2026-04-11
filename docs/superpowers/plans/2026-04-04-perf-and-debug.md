# Performance & Debugging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate sequential query waterfalls, narrow over-fetching, fix a balance data-integrity bug, and clean up minor issues that cause unnecessary re-renders and rare data corruption.

**Architecture:** All changes are isolated to existing files — no new abstractions, no new files. Each task is independent and safe to implement and review separately.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase JS v2, TypeScript 5

---

## File Map

| File | Task(s) | What changes |
|------|---------|--------------|
| `src/app/admin/page.tsx` | 1 | 4 sequential stat queries → `Promise.all` |
| `src/app/admin/tasks/page.tsx` | 1, 2 | 2 sequential data fetches → `Promise.all`; staff select narrowed |
| `src/context/AuthContext.tsx` | 1, 2 | bfcache handler parallelised; `fetchProfile` select narrowed |
| `src/app/leave/page.tsx` | 2 | leave_requests select narrowed |
| `src/app/admin/leave/page.tsx` | 3 | `handleReject` — balance restore order fixed with rollback |
| `src/components/PendingApprovalsWidget.tsx` | 4 | Remove `.limit(3)` cap |
| `src/context/ToastContext.tsx` | 5 | Replace `Date.now()` ID with monotonic counter |
| `src/components/LeaveBalanceCard.tsx` | 5 | Extract inline hover handlers to stable refs |

---

### Task 1: Parallelise Sequential Supabase Queries

**Files:**
- Modify: `src/app/admin/page.tsx:46-78`
- Modify: `src/app/admin/tasks/page.tsx:47-71`
- Modify: `src/context/AuthContext.tsx:198-216`

**Problem:** Three locations await Supabase queries one-by-one. Each query takes ~150–300ms on a good connection, so sequential chains of 2–4 queries add 300–1200ms of unnecessary latency per page load.

- [ ] **Step 1: Parallelise `fetchStats` in `src/app/admin/page.tsx`**

Find `fetchStats` (lines 46–78). Replace the 4 sequential awaits:

```typescript
    const fetchStats = async () => {
        const [
            { count: managerLeaveCount },
            { count: ownerLeaveCount },
            { count: taskCount },
            { count: staffCount },
        ] = await Promise.all([
            supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending_manager'),
            supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending_owner'),
            supabase
                .from('tasks')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending'),
            supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('role', 'staff'),
        ]);

        setStats({
            pendingManagerLeave: managerLeaveCount ?? 0,
            pendingOwnerLeave: ownerLeaveCount ?? 0,
            pendingTasks: taskCount ?? 0,
            staffCount: staffCount ?? 0,
        });
        setStatsLoading(false);
    };
```

- [ ] **Step 2: Parallelise `fetchData` in `src/app/admin/tasks/page.tsx`**

Find `fetchData` (lines 47–71). Replace the 2 sequential awaits:

```typescript
    const fetchData = async () => {
        const [{ data: staffData }, { data: tasksData }] = await Promise.all([
            supabase
                .from('profiles')
                .select('id, full_name')
                .order('full_name', { ascending: true }),
            supabase
                .from('tasks')
                .select('*')
                .eq('status', 'done')
                .order('completed_at', { ascending: false })
                .limit(10),
        ]);

        if (staffData) setStaff(staffData as User[]);
        if (tasksData) setRecentTasks(tasksData as Task[]);
        setTasksLoading(false);
    };
```

- [ ] **Step 3: Parallelise the bfcache handler in `src/context/AuthContext.tsx`**

Find `handlePageShow` (lines 198–216). The current code awaits `getSession` then awaits `fetchProfile` sequentially. Replace the inner `.then` callback:

```typescript
        const handlePageShow = (e: PageTransitionEvent) => {
            if (e.persisted) {
                supabase.auth.getSession().then(({ data: { session } }) => {
                    setSession(session);
                    setUser(session?.user ?? null);
                    if (session?.user) {
                        fetchProfile(session.user.id).then(profileData => {
                            setProfile(profileData);
                        });
                    } else {
                        setProfile(null);
                    }
                });
            }
        };
```

> Note: `getSession` must resolve before we know the `userId` needed for `fetchProfile`, so true parallelism isn't possible here. The fix is to avoid the nested `await` anti-pattern by using `.then()` chaining that doesn't block — which the code above already does correctly. The real gain is confirming the profile fetch is **not** blocking the session state update (it isn't after this change). No further change needed if the current code already does this — verify during implementation.

- [ ] **Step 4: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/app/admin/page.tsx src/app/admin/tasks/page.tsx src/context/AuthContext.tsx
git commit -m "perf: parallelise sequential Supabase queries with Promise.all"
```

---

### Task 2: Narrow `select('*')` to Specific Fields

**Files:**
- Modify: `src/context/AuthContext.tsx:36-40`
- Modify: `src/app/leave/page.tsx:39-43`
- Modify: `src/app/admin/tasks/page.tsx` (staff query — already narrowed in Task 1 Step 2 above)

**Problem:** `select('*')` fetches every column including ones never used. Narrowing reduces payload size and protects against schema additions accidentally bloating responses.

- [ ] **Step 1: Narrow `fetchProfile` in `src/context/AuthContext.tsx`**

Find `fetchProfile` (lines 34–51). Change:

```typescript
    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, email, full_name, role, annual_leave_balance, medical_leave_balance, is_active, created_at')
                .eq('id', userId)
                .single();
```

- [ ] **Step 2: Narrow leave_requests select in `src/app/leave/page.tsx`**

Find `fetchLeaveRequests` (lines 38–49). The card displays: `leave_type`, `start_date`, `end_date`, `days_requested`, `status`, `reason`, `attachment_url`, `is_retrospective`. The delete handler needs `id`, `days_requested`, `leave_type`. Ordering uses `created_at`. Change:

```typescript
    const fetchLeaveRequests = async () => {
        const { data, error } = await supabase
            .from('leave_requests')
            .select('id, user_id, leave_type, start_date, end_date, days_requested, status, reason, attachment_url, is_retrospective, created_at')
            .eq('user_id', user?.id)
            .order('created_at', { ascending: false });
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors. If TypeScript complains about missing fields on the partial type, add them back to the select string.

- [ ] **Step 4: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/context/AuthContext.tsx src/app/leave/page.tsx
git commit -m "perf: narrow select('*') to explicit field lists"
```

---

### Task 3: Fix Balance Restore Order in `handleReject`

**Files:**
- Modify: `src/app/admin/leave/page.tsx:188-225`

**Problem:** In `handleReject`, the leave status is updated to `rejected` first (line 200), then the balance is restored (lines 205–214). If the balance restore fails, the user's leave is rejected but their balance is permanently deducted — a silent data integrity bug. The fix: restore balance **first**, then update status. If status update fails, roll back the balance.

- [ ] **Step 1: Rewrite `handleReject` with safe ordering**

Find `handleReject` (lines 188–225). Replace the entire function body (keep the function signature):

```typescript
    const handleReject = async (request: LeaveRequestWithProfile) => {
        if (!currentUser) return;
        setProcessing(request.id);

        try {
            setRequests(prev => prev.filter(r => r.id !== request.id));
            setSelectedRequest(null);

            // 1. Restore balance FIRST — if this fails we haven't touched the status yet
            const requestUser = request.profiles;
            if (requestUser) {
                const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                const currentBalance = (requestUser as any)[balanceField] ?? 0;
                const { error: balanceError } = await supabase
                    .from('profiles')
                    .update({ [balanceField]: currentBalance + request.days_requested })
                    .eq('id', request.user_id);

                if (balanceError) {
                    // Balance restore failed — abort before touching status
                    throw new Error(`Balance restore failed: ${balanceError.message}`);
                }
            }

            // 2. Update status to rejected — balance is already safe
            const updateData = isOwner
                ? { status: 'rejected', owner_action_by: currentUser.id, owner_action_at: new Date().toISOString() }
                : { status: 'rejected', manager_action_by: currentUser.id, manager_action_at: new Date().toISOString() };

            const { error: statusError } = await supabase
                .from('leave_requests')
                .update(updateData)
                .eq('id', request.id);

            if (statusError) {
                // Status update failed — roll back the balance restore
                if (requestUser) {
                    const balanceField = request.leave_type === 'annual' ? 'annual_leave_balance' : 'medical_leave_balance';
                    const currentBalance = (requestUser as any)[balanceField] ?? 0;
                    await supabase
                        .from('profiles')
                        .update({ [balanceField]: currentBalance })
                        .eq('id', request.user_id);
                }
                throw statusError;
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

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/app/admin/leave/page.tsx
git commit -m "fix: restore balance before updating status in handleReject to prevent data loss"
```

---

### Task 4: Remove Hard Limit in PendingApprovalsWidget

**Files:**
- Modify: `src/components/PendingApprovalsWidget.tsx:42-43`

**Problem:** `.limit(3)` means managers/owners only ever see the 3 oldest pending requests. If there are 4+, the rest are invisible in the widget. Remove the cap so all pending requests appear.

- [ ] **Step 1: Remove `.limit(3)`**

Find `loadPendingRequests` in `src/components/PendingApprovalsWidget.tsx`. The query currently ends with:

```typescript
            .eq('status', statusFilter)
            .order('created_at', { ascending: true })
            .limit(3);
```

Remove the `.limit(3)` line:

```typescript
            .eq('status', statusFilter)
            .order('created_at', { ascending: true });
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/components/PendingApprovalsWidget.tsx
git commit -m "fix: remove .limit(3) cap on PendingApprovalsWidget so all requests are visible"
```

---

### Task 5: Minor Cleanup — Toast Counter + Hover Handler Extraction

**Files:**
- Modify: `src/context/ToastContext.tsx:20-21`
- Modify: `src/components/LeaveBalanceCard.tsx`

#### Part A — Toast ID counter

**Problem:** `const id = Date.now()` can produce duplicate IDs if two toasts are triggered within the same millisecond (e.g. on rapid double-submit). Use a module-level counter instead.

- [ ] **Step 1: Add a counter and replace `Date.now()`**

In `src/context/ToastContext.tsx`, add a counter before the component:

```typescript
let _toastId = 0;
```

Then in the `show` callback, replace:
```typescript
        const id = Date.now();
```
with:
```typescript
        const id = ++_toastId;
```

The `Toast` interface uses `id: number` — no type changes needed.

#### Part B — Stable hover handlers in LeaveBalanceCard

**Problem:** `onMouseEnter` and `onMouseLeave` are inline arrow functions on both cards in `LeaveBalanceCard.tsx`. They are recreated on every render, which causes unnecessary reconciliation work.

- [ ] **Step 2: Extract hover handlers**

In `src/components/LeaveBalanceCard.tsx`, add these two handler functions before the `return` statement:

```typescript
    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.transform = 'scale(1.02)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = 'none';
    };
```

Then replace all four inline handler props on both `stat-card` divs:

```tsx
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
```

Both cards get the same handlers (the style targets are identical).

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
git add src/context/ToastContext.tsx src/components/LeaveBalanceCard.tsx
git commit -m "fix: use monotonic counter for toast IDs; extract stable hover handlers in LeaveBalanceCard"
```

---

## Smoke Test Checklist

After all tasks:

- [ ] Admin dashboard loads — stats appear, no spinner hang
- [ ] Admin tasks page loads — staff dropdown populated, recently completed tasks visible
- [ ] Leave page loads — balance shown, request history shown
- [ ] As owner: reject a pending leave → balance is restored to employee, status becomes rejected
- [ ] As manager/owner with 4+ pending requests: widget shows all of them (not capped at 3)
- [ ] Trigger two toasts rapidly (e.g. double-click reject) — both toasts appear independently
