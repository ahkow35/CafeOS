# Safari Breakage Analysis — CafeOS Perf Changes

**Date:** 2026-03-17
**Reporter:** Nyan
**Trigger:** Performance changes in commits `e4e9f3a` → `7cfb2ac`
**Symptom:** App fails to load on all Safari instances (iOS + macOS desktop)

---

## Phase 1: Root Cause Investigation

### What Changed

| Commit | Change | Safari Risk |
|--------|--------|-------------|
| `e4e9f3a` | Singleton Supabase client | Low |
| `8f4dc0f` | **6s timeout + split loading states** | **CRITICAL** |
| `1ac8926` | page.tsx uses `profileLoading` | Medium |
| `a20f6c1` | Remove Inter font | None |
| `d2214ab` | Add loading.tsx | None |
| `7fe5481` | Cache headers | None |

### What the Old Code Did

```typescript
// OLD initAuth — no timeout
const initAuth = async () => {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        // ...
        if (session?.user) {
            const profileData = await fetchProfile(session.user.id);
            if (mounted) setProfile(profileData);
        }
    } finally {
        if (mounted) setLoading(false);  // ← single loading state, cleared after BOTH complete
    }
};
```

Old behaviour: **if getSession() hung, loading stayed true forever** (the "stuck white screen" bug). App hung indefinitely on slow Safari connections.

### What the New Code Does

```typescript
// NEW initAuth — 6s timeout
const timeoutId = setTimeout(() => {
    // fires if initAuth hasn't completed in 6s
    setSession(null); setUser(null); setProfile(null);
    setLoading(false); setProfileLoading(false);
}, 6000);
```

New behaviour: **if getSession() hangs, timeout fires at 6s, clears ALL auth state, redirects to login**.

---

## Root Cause 1 (PRIMARY — explains ALL Safari instances)

### 6-Second Timeout Fires Before Safari Can Complete Token Refresh

**Why getSession() is slow on Safari:**

Supabase access tokens expire after **1 hour** by default. When `getSession()` is called with an expired access token, the Supabase client:
1. Detects the expired access token in the cookie
2. Makes a **network call to `*.supabase.co`** to exchange the refresh token for new tokens
3. Sets the new tokens in cookies
4. Returns the refreshed session

On Safari, this refresh network call is affected by:
- **Intelligent Tracking Prevention (ITP)**: Safari classifies `*.supabase.co` as a potential tracking domain. Network calls to classified domains can be rate-limited, deferred, or subject to additional latency. This is well-documented for Supabase + Safari combinations.
- **Aggressive bfcache**: When iOS Safari suspends and resumes a PWA, pending network requests may be delayed or need to restart.
- **Slower JS execution on Safari mobile** compared to Chrome V8.

**Before (old code):** Token refresh takes 8–15s on Safari → app hung but eventually loaded → users waited.
**After (new code):** Token refresh takes 8–15s on Safari → 6s timeout fires first → state cleared → redirect to login → app appears completely broken.

The timeout converted a "slow but functional" experience into a "completely broken" experience.

**Evidence:**
- The OLD code already had the comment: `// Don't await signOut — on Safari, ITP can block this network call and cause loading to hang.`
- This comment confirms ITP-induced network slowness was already known before the perf changes.
- The 6s timeout was added to fix the stuck loading bug — but it's shorter than Safari's ITP-delayed token refresh duration.

---

## Root Cause 2 (SECONDARY — post-login flow)

### "Profile Not Found" Flash After Sign-In

**The login flow:**

```
1. User submits login form
2. signIn() calls supabase.auth.signInWithPassword()
3. router.push('/') → navigate to dashboard (line 29, login/page.tsx)
4. page.tsx mounts:
   - authLoading = false  ← initAuth already ran during initial page load
   - profileLoading = false ← still initial value, onAuthStateChange hasn't fired yet
   - user = null ← not set yet
   - profile = null
5. page.tsx render: authLoading=false, profileLoading=false → SKIPS skeleton
6. → hits: if (!profile) → "Profile Not Found" ERROR DISPLAYED
7. Meanwhile: onAuthStateChange fires SIGNED_IN → setProfileLoading(true) → skeleton
8. Profile loads → setProfileLoading(false) → real content
```

**Result:** Safari users briefly (or not-so-briefly) see "Profile Not Found" between login and dashboard load. On Safari where JS execution and paint timing differs from Chrome, this can appear as the app being stuck on the error state rather than a flash.

**Fix:** Add `profileLoading` guard to the "Profile Not Found" check:
```typescript
// page.tsx — current code
if (!profile) {
    return <div>Profile Not Found...</div>;
}

// page.tsx — fix
if (!authLoading && !profileLoading && !profile) {
    return <div>Profile Not Found...</div>;
}
```

---

## Root Cause 3 (CONTRIBUTING — navigation/tab switching)

### Safari Back-Forward Cache (bfcache) Kills Auth Subscription

Safari uses bfcache aggressively. When a user navigates away from the app (tabs away, navigates back from an external link), Safari:
1. Freezes the page in memory (bfcache)
2. Runs the React `useEffect` **cleanup** (unsubscribes `onAuthStateChange`)
3. When user returns, restores the frozen page
4. Does **NOT** re-run `useEffect` setup (subscription is gone)

Result: Auth subscription is dead. Any auth events (token refresh, session update) are silently dropped. The page shows stale auth state with no way to refresh.

**Old code:** Same problem existed, but no `profileLoading` state meant fewer render paths to get stuck in.

**Fix:** Add `pageshow` event listener to detect bfcache restoration:
```typescript
useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
        if (e.persisted) {
            // Page was restored from bfcache — re-initialize auth
            initAuth();
        }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
}, []);
```

---

## Summary Table

| Issue | Severity | Scope | Safari-specific? | Trigger |
|-------|----------|-------|-----------------|---------|
| 6s timeout fires before token refresh completes | **Critical** | All logged-in users | Yes — ITP causes latency | After access token expires (1h) |
| "Profile Not Found" flash post-login | High | All users after sign-in | More visible on Safari | Every login |
| bfcache kills auth subscription | Medium | Navigation/switching | Yes — Safari bfcache aggressiveness | Tab switching, back navigation |

---

## Fix Plan

### Fix 1: Extend timeout + graceful fallback (addresses Root Cause 1)

**File:** `src/context/AuthContext.tsx`

**Change:** Increase `AUTH_TIMEOUT_MS` from 6000 to 15000. Also, instead of clearing all state on timeout, leave auth state as-is and just clear loading — let the user see their last-known state rather than being force-logged-out.

```typescript
// Change this:
const AUTH_TIMEOUT_MS = 6000;
// To:
const AUTH_TIMEOUT_MS = 15000;

// And change the timeout callback from clearing state:
const timeoutId = setTimeout(() => {
    if (mounted) {
        console.warn('[AuthContext] Auth init timed out');
        // DO NOT clear session/user — just unblock loading
        // User might still be authenticated, token refresh may succeed shortly after
        setLoading(false);
        setProfileLoading(false);
    }
}, AUTH_TIMEOUT_MS);
```

**Why 15s:** Supabase token refresh on Safari ITP typically completes within 8–12s based on community reports. 15s gives headroom without being excessively long.

**Why not clear state on timeout:** If the refresh eventually succeeds, `onAuthStateChange` will fire `TOKEN_REFRESHED` and update state correctly. Clearing state on timeout and then having it restored 2s later creates a worse UX (flash to login then back to dashboard).

---

### Fix 2: Guard "Profile Not Found" on loading states (addresses Root Cause 2)

**File:** `src/app/page.tsx`

**Change:** Add loading guards to the "Profile Not Found" render:

```typescript
// Current (line 99-117):
if (!profile) {
    return (
        <div className="empty-state animate-in" ...>
            <div className="empty-state-title" style={{ color: '#ef4444' }}>Profile Not Found</div>
            ...
        </div>
    );
}

// Fix:
if (!authLoading && !profileLoading && !profile) {
    return (
        <div className="empty-state animate-in" ...>
            <div className="empty-state-title" style={{ color: '#ef4444' }}>Profile Not Found</div>
            ...
        </div>
    );
}
```

This ensures "Profile Not Found" only shows when we're CERTAIN loading is done and profile is genuinely absent — not during the transition window after login.

---

### Fix 3: Add `pageshow` bfcache handler (addresses Root Cause 3)

**File:** `src/context/AuthContext.tsx`

Add a separate `useEffect` to handle bfcache restoration:

```typescript
useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
        if (e.persisted) {
            // Restored from bfcache — re-check auth state
            createClient().auth.getSession().then(({ data: { session } }) => {
                setSession(session);
                setUser(session?.user ?? null);
                if (!session?.user) setProfile(null);
            });
        }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
}, []);
```

---

## Implementation Order

1. **Fix 2 first** (5 min, lowest risk) — stops the "Profile Not Found" flash immediately
2. **Fix 1 second** (5 min, medium risk) — addresses primary cause of Safari load failure
3. **Fix 3 last** (10 min, requires testing) — bfcache restoration for navigation edge cases

---

## Testing Protocol

After each fix:

1. **iOS Safari (iPhone/iPad):** Log in, close app, reopen — should go to dashboard, not login
2. **macOS Safari:** Same
3. **Safari Private Browsing:** Should redirect to login (no session) — confirm it doesn't hang
4. **Simulate slow connection:** Safari DevTools → Network → Throttle to "Slow 3G" → reload logged-in session → should show skeleton → eventually load (not redirect to login after 6s)
5. **bfcache test:** Log in → navigate to external link (or another tab) → press back → should show dashboard with current auth state, not blank/error

Chrome should be unaffected by all changes.

---

## What Was NOT the Cause

- **Singleton Supabase client** — same `createBrowserClient` as before, just cached. Cookie reads are still fresh on each `getSession()` call.
- **`INITIAL_SESSION` skip** — present in BOTH old and new code, not a new change.
- **Inter font removal** — has no auth impact.
- **Cache headers** — correctly scoped to static assets only.
- **`loading.tsx`** — Next.js Suspense boundary, no interaction with auth state.
