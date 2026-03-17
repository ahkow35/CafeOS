'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';
import { User } from '@/lib/database.types';

interface AuthContextType {
    user: SupabaseUser | null;
    profile: User | null;
    session: Session | null;
    loading: boolean;
    profileLoading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    resetPassword: (email: string) => Promise<{ error: Error | null }>;
    updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [profileLoading, setProfileLoading] = useState(false);

    const supabase = createClient();

    // 2. Helper Functions
    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) {
                console.error('[DEBUG] Profile fetch error:', error.message, error.code, error.details);
                return null;
            }
            return data;
        } catch (err) {
            console.error('[DEBUG] Unexpected error fetching profile:', err);
            return null;
        }
    };

    const refreshProfile = async () => {
        if (user) {
            const profileData = await fetchProfile(user.id);
            setProfile(profileData);
        }
    };

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        return { error: error as Error | null };
    };

    const signUp = async (email: string, password: string, name: string) => {
        const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name },
                emailRedirectTo: `${window.location.origin}/`,
            },
        });
        return { error: error as Error | null };
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setSession(null);
    };

    const resetPassword = async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });
        return { error: error as Error | null };
    };

    const updatePassword = async (newPassword: string) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        return { error: error as Error | null };
    };

    // 3. The Effect Hook
    useEffect(() => {
        let mounted = true;
        const AUTH_TIMEOUT_MS = 15000;

        const initAuth = async () => {
            // Timeout safety net — if initAuth hangs, unblock UI after 15s
            const timeoutId = setTimeout(() => {
                if (mounted) {
                    console.warn('[AuthContext] Auth init timed out — unblocking loading without clearing session');
                    setLoading(false);
                    setProfileLoading(false);
                }
            }, AUTH_TIMEOUT_MS);

            try {
                const { data: { session }, error } = await supabase.auth.getSession();

                if (!mounted) return;

                // Handle invalid refresh token error
                if (error) {
                    console.warn('Session restoration failed:', error.message);
                    // Don't await signOut — on Safari, ITP can block this network call
                    // and cause loading to hang. Just clear local state immediately.
                    supabase.auth.signOut();
                    setSession(null);
                    setUser(null);
                    setProfile(null);
                    setLoading(false);        // explicit unlock before early return
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
                // Don't await signOut — same Safari ITP hang risk
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

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (!mounted) return;

                // INITIAL_SESSION is already handled by initAuth above; skip to avoid double fetch
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

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        const handlePageShow = (e: PageTransitionEvent) => {
            if (e.persisted) {
                // Page restored from bfcache — re-check auth state and re-fetch profile
                supabase.auth.getSession().then(async ({ data: { session } }) => {
                    setSession(session);
                    setUser(session?.user ?? null);
                    if (session?.user) {
                        const profileData = await fetchProfile(session.user.id);
                        setProfile(profileData);
                    } else {
                        setProfile(null);
                    }
                });
            }
        };
        window.addEventListener('pageshow', handlePageShow);
        return () => window.removeEventListener('pageshow', handlePageShow);
    }, []);

    // 4. Return the Provider
    return (
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
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
