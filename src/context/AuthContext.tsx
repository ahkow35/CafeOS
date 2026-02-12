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
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
    signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    // 1. Define State and Client INSIDE the component
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    const supabase = createClient();

    // 2. Helper Functions
    const fetchProfile = async (userId: string) => {
        try {
            const { data, error, status } = await supabase
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
                data: { full_name: name }, // Ensure we save the name to metadata
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

    // 3. The Effect Hook (MUST BE INSIDE)
    useEffect(() => {
        let mounted = true;

        const initAuth = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();

                if (!mounted) return;

                // Handle invalid refresh token error
                if (error) {
                    console.warn("Session restoration failed:", error.message);
                    // Clear any invalid session data
                    await supabase.auth.signOut();
                    setSession(null);
                    setUser(null);
                    setProfile(null);
                    return;
                }

                setSession(session);
                setUser(session?.user ?? null);

                if (session?.user) {
                    const profileData = await fetchProfile(session.user.id);
                    if (mounted) setProfile(profileData);
                }
            } catch (error) {
                console.error("Auth Init Error:", error);
                // Clear session on any error
                await supabase.auth.signOut();
                setSession(null);
                setUser(null);
                setProfile(null);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (!mounted) return;

                setSession(session);
                setUser(session?.user ?? null);

                if (session?.user) {
                    const profileData = await fetchProfile(session.user.id);
                    if (mounted) setProfile(profileData);
                } else {
                    if (mounted) setProfile(null);
                }

                if (mounted) setLoading(false);
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    // 4. Return the Provider
    return (
        <AuthContext.Provider
            value={{
                user,
                profile,
                session,
                loading,
                signIn,
                signUp,
                signOut,
                refreshProfile,
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
