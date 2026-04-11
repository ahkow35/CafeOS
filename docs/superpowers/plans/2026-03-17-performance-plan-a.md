# CafeOS Performance — Plan A Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the stuck white screen on load and reduce time-to-interactive by fixing the auth waterfall, Supabase client waste, and dead assets.

**Architecture:** Fix the two-call auth waterfall by (1) making `setLoading(false)` fire after `getSession()` resolves instead of waiting for profile, (2) adding a 6s timeout so the UI never hangs forever, and (3) singleton-ifying the Supabase client so it isn't recreated on every render.

**Tech Stack:** Next.js 16, React 19, Supabase SSR, TypeScript

---

## Files Changed

| File | Action | Why |
|------|--------|-----|
| `src/lib/supabase.ts` | Modify | Singleton client — prevents new instance on every render |
| `src/context/AuthContext.tsx` | Modify | Timeout guard + move `setLoading(false)` earlier + expose `profileLoading` |
| `src/app/page.tsx` | Modify | Handle `profileLoading`, remove duplicate `fetchTodaysTasks` |
| `src/app/layout.tsx` | Modify | Remove unused Inter font (loaded but overridden by globals.css) |
| `src/app/loading.tsx` | Create | Instant skeleton during page navigation |
| `next.config.ts` | Modify | Add cache headers for static assets |

---

## Chunk 1: Supabase Client + Auth Fixes

### Task 1: Singleton Supabase client

**Files:**
- Modify: `src/lib/supabase.ts`

**Problem:** `createClient()` is called inside component bodies (AuthContext line 30, page.tsx line 18). Every render creates a new `SupabaseClient` instance, which re-establishes connections and wastes memory.

**Fix:** Module-level singleton — one instance shared across the app.

- [ ] **Step 1: Replace `src/lib/supabase.ts` with singleton version**

```typescript
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

// Browser-only singleton — do NOT import in Server Components or API route handlers.
// Those require a per-request client with cookie context (use @supabase/ssr createServerClient).
let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
    if (!client) {
        client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
    }
    return client;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "perf: singleton supabase client — prevent new instance per render"
```

---

### Task 2: Auth timeout guard + split loading states

**Files:**
- Modify: `src/context/AuthContext.tsx`

**Problems:**
1. `setLoading(false)` only fires after BOTH `getSession()` AND `fetchProfile()` complete. If `fetchProfile()` hangs, loading stays `true` forever — the "stuck" bug.
2. Users wait for both calls (~400ms) before seeing anything. The UI only needs `getSession()` result (~100-200ms) to know auth state.

**Fix:**
- Add `profileLoading: boolean` state (separate from `loading`)
- Move `setLoading(false)` to after `getSession()` resolves — unblocks UI immediately
- Add 6s timeout: if `initAuth()` hangs, force `setLoading(false)` and clear state

- [ ] **Step 1: Update `AuthContextType` interface to include `profileLoading`**

In `src/context/AuthContext.tsx`, update the interface:

```typescript
interface AuthContextType {
    user: SupabaseUser | null;
    profile: User | null;
    session: Session | null;
    loading: boolean;
    profileLoading: boolean;          // ← add this
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ error: Error | null }>;
    updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
}
```

- [ ] **Step 2: Add `profileLoading` state inside `AuthProvider`**

After the existing `useState` declarations (around line 28), add:

```typescript
const [profileLoading, setProfileLoading] = useState(false);
```

- [ ] **Step 3: Replace `initAuth` with timeout-guarded, split-loading version**

Replace the entire `initAuth` function (lines 102–137) with:

```typescript
const AUTH_TIMEOUT_MS = 6000;

const initAuth = async () => {
    // Timeout safety net — if initAuth hangs, unblock UI after 6s
    const timeoutId = setTimeout(() => {
        if (mounted) {
            console.warn('[AuthContext] Auth init timed out — clearing state');
            setSession(null);
            setUser(null);
            setProfile(null);
            setLoading(false);
            setProfileLoading(false);
        }
    }, AUTH_TIMEOUT_MS);

    try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (!mounted) return;

        if (error) {
            console.warn('Session restoration failed:', error.message);
            supabase.auth.signOut();
            setSession(null);
            setUser(null);
            setProfile(null);
            setLoading(false);        // ← explicit unlock before early return
            setProfileLoading(false);
            return;
        }

        setSession(session);
        setUser(session?.user ?? null);

        // ✅ Unblock UI — auth state is now known, profile loads in background
        if (mounted) setLoading(false);

        if (session?.user) {
            setProfileLoading(true);
            const profileData = await fetchProfile(session.user.id);
            if (mounted) {
                setProfile(profileData);
                setProfileLoading(false);
            }
        }
    } catch (err) {
        console.error('Auth Init Error:', err);
        supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setProfile(null);
    } finally {
        clearTimeout(timeoutId);
        // Safety net — ensures loading is always cleared even on unexpected throws
        if (mounted) {
            setLoading(false);
            setProfileLoading(false);
        }
    }
};
```

- [ ] **Step 4: Update `onAuthStateChange` handler to mirror `profileLoading`**

The `onAuthStateChange` handler (lines 141–160 in the current file) also calls `fetchProfile`. It must be updated to wrap that call with `setProfileLoading(true/false)` — otherwise profile loads triggered by sign-in events won't set the state correctly.

Replace the `onAuthStateChange` callback body with:

```typescript
const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
        if (!mounted) return;

        // INITIAL_SESSION is handled by initAuth above — skip to avoid double fetch
        if (event === 'INITIAL_SESSION') return;

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
            setProfileLoading(true);
            const profileData = await fetchProfile(session.user.id);
            if (mounted) {
                setProfile(profileData);
                setProfileLoading(false);
            }
        } else {
            if (mounted) {
                setProfile(null);
                setProfileLoading(false);
            }
        }
    }
);
```

- [ ] **Step 5: Add `profileLoading` to the context Provider value**

In the `AuthContext.Provider` value object (around line 170), add `profileLoading`:

```typescript
<AuthContext.Provider
    value={{
        user,
        profile,
        session,
        loading,
        profileLoading,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        resetPassword,
        updatePassword,
    }}
>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors. If errors about `profileLoading`, ensure the interface and Provider value both have it.

- [ ] **Step 7: Commit**

```bash
git add src/context/AuthContext.tsx
git commit -m "perf: split auth/profile loading states, add 6s timeout guard"
```

---

### Task 3: Update page.tsx to use `profileLoading`

**Files:**
- Modify: `src/app/page.tsx`

**Problems:**
1. `page.tsx` uses `authLoading` to gate rendering. Now that `loading` becomes false before profile is ready, `profile === null` would briefly show the "Profile Not Found" error. Need to also wait on `profileLoading` for profile-dependent content.
2. `fetchTodaysTasks` (lines 61–74) is an exact duplicate of the fetch logic inside `loadDashboardData` (lines 40–58). Delete it and call `loadDashboardData` instead.

- [ ] **Step 1: Import `profileLoading` from `useAuth`**

Update the destructuring on the `useAuth` line:

```typescript
const { user, profile, loading: authLoading, profileLoading } = useAuth();
```

- [ ] **Step 2: Update the `useEffect` dependency array and internal guard**

The `useEffect` at line 24 has dependency array `[user, authLoading, router]`. Add `profileLoading` so the effect re-evaluates when profile loading state changes, and add an internal guard to match:

```typescript
useEffect(() => {
    if (authLoading || profileLoading) return;   // ← guard both states

    if (!user) {
        router.push('/login');
        return;
    }

    loadDashboardData();
}, [user, authLoading, profileLoading, router]);  // ← add profileLoading
```

- [ ] **Step 3: Update the render loading gate condition**

Replace:
```typescript
if (authLoading || dataLoading) {
```
With:
```typescript
if (authLoading || profileLoading || dataLoading) {
```

This shows the skeleton while profile is still loading in the background, preventing the brief "Profile Not Found" flash.

- [ ] **Step 4: Delete the duplicate `fetchTodaysTasks` function**

Remove lines 61–74 entirely:
```typescript
// DELETE THIS ENTIRE FUNCTION — it's a duplicate of loadDashboardData's fetch logic
const fetchTodaysTasks = async () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .lte('deadline', today.toISOString())
        .order('deadline', { ascending: true })
        .limit(5);
    if (data) setTasks(data as Task[]);
};
```

- [ ] **Step 5: Replace the `onComplete` prop on `TaskCard`**

The `TaskCard` was using `fetchTodaysTasks` as its `onComplete` callback. Replace it with `loadDashboardData`:

```typescript
<TaskCard
    key={task.id}
    task={task}
    onComplete={loadDashboardData}
/>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "perf: use profileLoading state, remove duplicate fetchTodaysTasks"
```

---

## Chunk 2: Asset + Navigation Fixes

### Task 4: Remove unused Inter font

**Files:**
- Modify: `src/app/layout.tsx`

**Problem:** `layout.tsx` loads the Inter font via `next/font/google` and applies it as `inter.className` on `<body>`. But `globals.css` imports Oswald and Roboto Mono via `@import url(...)`, which overrides Inter completely. Inter is downloaded but never displayed — wasted ~20KB network request per visit.

- [ ] **Step 1: Remove Inter font from `layout.tsx`**

Replace the current `layout.tsx` with:

```typescript
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ToastProvider } from "@/context/ToastContext";

export const metadata: Metadata = {
  title: "CafeOS - Staff Portal",
  description: "Easy to Use Leave Management and Task Management for small Cafes - hyperlocalized",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CafeOS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "perf: remove unused Inter font — overridden by globals.css"
```

---

### Task 5: Add `loading.tsx` for instant navigation skeleton

**Files:**
- Create: `src/app/loading.tsx`

**Problem:** There is no `loading.tsx` at the app root. During page navigation, Next.js shows a blank screen until the new page's data finishes loading. A `loading.tsx` file makes Next.js show an instant skeleton during any route transition.

- [ ] **Step 1: Create `src/app/loading.tsx`**

```typescript
export default function Loading() {
  return (
    <main className="page">
      <div className="container">
        <section className="section">
          <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 16, width: '40%' }} />
        </section>
        <section className="section">
          <div className="skeleton" style={{ height: 20, width: '30%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 80, borderRadius: 8 }} />
        </section>
        <section className="section">
          <div className="skeleton" style={{ height: 20, width: '35%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 64, borderRadius: 8, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 64, borderRadius: 8 }} />
        </section>
      </div>
    </main>
  );
}
```

Note: The `.skeleton` and `.page`/`.container`/`.section` classes already exist in `globals.css`. No new CSS needed.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/loading.tsx
git commit -m "perf: add loading.tsx — instant skeleton during page navigation"
```

---

### Task 6: Add static asset cache headers

**Files:**
- Modify: `next.config.ts`

**Problem:** Static assets (JS bundles, CSS, icons) are served without explicit cache headers. Browsers re-validate them on every page load. Adding long-lived cache headers for immutable assets speeds up repeat visits significantly.

- [ ] **Step 1: Update `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        // Next.js hashed static assets — safe to cache for 1 year
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // PWA icons and manifest
        source: "/icons/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "perf: add cache headers for static assets and PWA files"
```

---

## Verification

After all tasks are complete, do a full end-to-end check:

- [ ] **Build succeeds**
```bash
npm run build
```
Expected: Build completes with no errors. Note the route sizes in output.

- [ ] **Dev server starts**
```bash
npm run dev
```
Expected: No console errors on startup.

- [ ] **White screen duration reduced**
Open Chrome DevTools → Network tab → throttle to "Slow 3G" → hard reload the app.
Expected: Skeleton appears as soon as auth resolves (~200ms), not after profile loads (~400ms).

- [ ] **Stuck white screen no longer possible**
To simulate: In `src/context/AuthContext.tsx`, temporarily add `await new Promise(r => setTimeout(r, 10000))` at the top of the `fetchProfile` function (before the Supabase query). Reload the app.
Expected: Skeleton shows, then after 6 seconds loading clears and app redirects to login (timeout fires). Revert the test change after verifying.

- [ ] **Supabase client is a singleton**
Add `console.log('[supabase] creating client')` inside the `if (!client)` block in `supabase.ts`. Navigate between pages.
Expected: Log appears exactly once per browser session. Revert after verifying.

- [ ] **Inter font not loaded**
Chrome DevTools → Network tab → filter by "font" → hard reload.
Expected: No request for `inter` font. Only Oswald and Roboto Mono from Google Fonts.

- [ ] **Cache headers present**
Chrome DevTools → Network tab → click any `/_next/static/` asset → Headers tab.
Expected: `cache-control: public, max-age=31536000, immutable`

---

## Summary of Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| White screen (logged-in user) | ~400ms (getSession + fetchProfile) | ~150-200ms (getSession only) |
| Stuck white screen | Indefinite | Max 6s, then redirect to login |
| Supabase client instances | 1 per render | 1 per browser session |
| Wasted font download | ~20KB (Inter, unused) | 0 |
| Navigation feedback | Blank flash | Instant skeleton |
| Repeat visit asset load | No cache | 1-year cache for JS/CSS |
