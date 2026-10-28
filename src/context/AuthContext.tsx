'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { MembershipRole } from '@/lib/validators';

export type Role = MembershipRole;

export interface CafeInfo {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

export interface MembershipInfo {
  cafe: CafeInfo;
  role: Role;
}

export interface SessionUser {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: Role | null;         // role in active_cafe; null for super-admin-only sessions
  annual_leave_balance: number;
  medical_leave_balance: number;
  medical_claim_balance: number;
  hourly_rate: number | null;
  is_active: boolean;
  is_super_admin: boolean;
  email: string | null;
  telegram_chat_id: string | null;
  active_cafe: CafeInfo | null;
  memberships: MembershipInfo[];
}

export type LoginOutcome =
  | { kind: 'redirect'; to: string }
  | { kind: 'pick'; memberships: MembershipInfo[]; isSuperAdmin: boolean };

interface AuthContextType {
  user: SessionUser | null;
  profile: SessionUser | null; // alias — backwards compat with existing pages
  loading: boolean;
  profileLoading: boolean;
  signIn: (phone: string, pin: string) => Promise<{ error: Error | null; outcome?: LoginOutcome }>;
  signOut: () => Promise<void>;
  switchCafe: (cafeId: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by every /me request and every sign-in/out, so a slow /me reply
  // can't overwrite newer auth state (e.g. sign a fresh login back out, or
  // restore an older balance).
  const authSeq = useRef(0);

  const refreshProfile = useCallback(async () => {
    const seq = ++authSeq.current;
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (seq !== authSeq.current) return;
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (!res.ok) {
        console.warn('[AuthContext] /me transient failure', res.status);
        return;
      }
      const json = (await res.json()) as { user: SessionUser | null };
      if (seq !== authSeq.current) return;
      setUser(json.user);
    } catch (err) {
      console.warn('[AuthContext] /me network error', err);
    } finally {
      // Only the latest request ends initial loading; a superseded one must not
      // report "no user" while a newer /me is still in flight.
      if (seq === authSeq.current) setLoading(false);
    }
  }, []);

  const signIn = useCallback(async (phone: string, pin: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        user?: SessionUser;
        error?: string;
        code?: string;
        redirect?: string;
        memberships?: MembershipInfo[];
        isSuperAdmin?: boolean;
      };

      if (!res.ok) {
        // No parseable body means the request never reached the route (platform 502,
        // gateway timeout) — that is never a credentials problem, so don't imply it is.
        return {
          error: new Error(
            json.error ?? "Can't reach CafeOS right now. Please try again in a moment.",
          ),
        };
      }

      // Multi-cafe picker — caller shows selection UI.
      if (json.memberships) {
        return {
          error: null,
          outcome: {
            kind: 'pick' as const,
            memberships: json.memberships,
            isSuperAdmin: json.isSuperAdmin ?? false,
          } satisfies LoginOutcome,
        };
      }

      // Single destination — session cookie already set.
      if (json.user) {
        authSeq.current++;
        setUser(json.user);
        setLoading(false);
      }
      return {
        error: null,
        outcome: { kind: 'redirect' as const, to: json.redirect ?? '/' } satisfies LoginOutcome,
      };
    } catch (err) {
      // fetch() only rejects on network failure; its raw message ("Failed to fetch")
      // means nothing to a barista standing at the till.
      console.error('[AuthContext] /login network error', err);
      return {
        error: new Error("Can't reach CafeOS right now. Check your connection and try again."),
      };
    }
  }, []);

  const switchCafe = useCallback(async (cafeId: string) => {
    try {
      const res = await fetch('/api/auth/switch-cafe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cafeId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { error: new Error(json.error ?? 'Switch failed') };
      }
      await refreshProfile();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Switch failed') };
    }
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookie still gets cleared on next protected request anyway.
    }
    authSeq.current++;
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  // The provider lives in the root layout, so it survives in-app navigation.
  // Re-read the profile on each route change so balances an admin changed
  // since login (claim cap, leave days) are not shown stale.
  const pathname = usePathname();
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    refreshProfile();
  }, [pathname, refreshProfile]);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) refreshProfile();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [refreshProfile]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user,
        loading,
        profileLoading: loading,
        signIn,
        signOut,
        switchCafe,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
