'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

export type Role = 'staff' | 'manager' | 'owner' | 'part_timer';

export interface SessionUser {
  id: string;
  phone_e164: string;
  full_name: string;
  job_title: string | null;
  role: Role;
  annual_leave_balance: number;
  medical_leave_balance: number;
  hourly_rate: number | null;
  is_active: boolean;
  email: string | null;
}

interface AuthContextType {
  user: SessionUser | null;
  profile: SessionUser | null; // alias for backwards-compat with existing pages
  loading: boolean;
  profileLoading: boolean;
  signIn: (phone: string, pin: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.status === 401) {
        setUser(null);
        return;
      }
      if (!res.ok) {
        // Transient error (503, 500, network blip) — keep existing auth state.
        console.warn('[AuthContext] /me transient failure', res.status);
        return;
      }
      const json = (await res.json()) as { user: SessionUser | null };
      setUser(json.user);
    } catch (err) {
      // Network error — do NOT log the user out.
      console.warn('[AuthContext] /me network error', err);
    }
  }, []);

  const signIn = useCallback(async (phone: string, pin: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        return { error: new Error(json.error ?? 'Login failed') };
      }
      const json = (await res.json()) as { user: SessionUser };
      setUser(json.user);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Login failed') };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookie still gets cleared on next protected request anyway.
    }
    setUser(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await refreshProfile();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [refreshProfile]);

  // Re-check session when the page is restored from bfcache.
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
