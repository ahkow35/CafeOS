'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import TeamMemberCard from '@/components/TeamMemberCard';

export default function ManageTeamPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const supabase = createClient();
    const toast = useToast();

    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string>('');

    useEffect(() => {
        if (!authLoading) {
            if (!user) {
                router.push('/login');
            } else {
                loadData();
            }
        }
    }, [user, authLoading]);

    const loadData = async () => {
        if (!user) return;

        setLoading(true);
        setError(null);

        try {
            const { data: currentUserProfile, error: profileError } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single();

            if (profileError) {
                setError(`Role check failed: ${profileError.message}`);
                return;
            }

            if (!currentUserProfile || currentUserProfile.role !== 'owner') {
                router.push('/');
                return;
            }

            setCurrentUserRole(currentUserProfile.role);

            const { data: allProfiles, error: fetchError } = await supabase
                .from('profiles')
                .select('id, full_name, email, role, is_active, hourly_rate, phone')
                .order('full_name', { ascending: true });

            if (fetchError) {
                setError(`Team fetch failed: ${fetchError.message}`);
                return;
            }

            setProfiles((allProfiles || []) as User[]);

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleHourlyRateChange = async (targetUserId: string, rate: number) => {
        setUpdating(targetUserId);
        const { error } = await supabase
            .from('profiles')
            .update({ hourly_rate: rate })
            .eq('id', targetUserId);
        if (!error) {
            setProfiles(prev => prev.map(p => p.id === targetUserId ? { ...p, hourly_rate: rate } : p));
            toast(`Hourly rate updated to S$${rate}/hr`, 'success');
        } else {
            toast(`Failed to update rate: ${error.message}`, 'error');
        }
        setUpdating(null);
    };

    const handleRoleChange = async (targetUserId: string, newRole: string) => {
        const typedRole = newRole as User['role'];
        if (targetUserId === user?.id) {
            toast("You cannot change your own role.", 'error');
            return;
        }

        const confirmUpdate = window.confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`);
        if (!confirmUpdate) return;

        setUpdating(targetUserId);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ role: typedRole })
                .eq('id', targetUserId);

            if (error) throw error;

            setProfiles(prev => prev.map(p =>
                p.id === targetUserId ? { ...p, role: typedRole } : p
            ));

            toast(`Role updated to ${newRole.toUpperCase()}!`, 'success');
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            toast(`Failed to update role: ${errorMessage}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
        const action = currentStatus ? 'disable' : 'enable';
        if (!confirm(`Are you sure you want to ${action} this user?`)) return;

        setUpdating(userId);

        const { error } = await supabase
            .from('profiles')
            .update({ is_active: !currentStatus })
            .eq('id', userId);

        if (!error) {
            setProfiles(prev => prev.map(p =>
                p.id === userId ? { ...p, is_active: !currentStatus } : p
            ));
            toast(`User ${action}d successfully!`, 'success');
        } else {
            toast(`Failed to ${action} user: ${error.message}`, 'error');
        }
        setUpdating(null);
    };

    const removeUser = async (userId: string, userName: string) => {
        if (!confirm(`⚠️ WARNING: Are you sure you want to PERMANENTLY DELETE ${userName}? This action CANNOT be undone!`)) return;

        setUpdating(userId);

        const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', userId);

        if (!error) {
            setProfiles(prev => prev.filter(p => p.id !== userId));
            toast(`${userName} has been removed from the system.`, 'success');
        } else {
            toast(`Failed to remove user: ${error.message}`, 'error');
        }
        setUpdating(null);
    };

    if (loading) {
        return (
            <>
                <Header />
                <main className="page">
                    <div className="container">
                        <section className="page-header animate-in">
                            <h1 className="page-title">Manage Team</h1>
                            <p className="page-subtitle">Assign roles and permissions</p>
                        </section>
                        <section className="section animate-in">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {[1, 2, 3].map(i => (
                                    <div
                                        key={i}
                                        style={{
                                            height: '80px',
                                            borderRadius: 'var(--border-radius)',
                                            background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
                                            backgroundSize: '200% 100%',
                                            animation: 'shimmer 1.5s infinite',
                                        }}
                                    />
                                ))}
                            </div>
                            <style jsx>{`
                                @keyframes shimmer {
                                    0% { background-position: 200% 0; }
                                    100% { background-position: -200% 0; }
                                }
                            `}</style>
                        </section>
                    </div>
                </main>
                <BottomNav />
            </>
        );
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Manage Team</h1>
                        <p className="page-subtitle">Assign roles and permissions</p>
                    </section>

                    {error && (
                        <div style={{
                            backgroundColor: '#fee2e2',
                            border: '1px solid #ef4444',
                            color: '#b91c1c',
                            padding: '1rem',
                            borderRadius: 'var(--border-radius)',
                            marginBottom: '1rem'
                        }}>
                            <strong>Error:</strong> {error}
                            <button
                                onClick={loadData}
                                style={{
                                    marginLeft: '1rem',
                                    textDecoration: 'underline',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'inherit',
                                    fontWeight: 'bold'
                                }}
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {profiles.length === 0 && !error ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-title">No profiles found</div>
                            <p>No profiles found in database.</p>
                        </div>
                    ) : (
                        <section className="section animate-in">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {profiles.map(profile => (
                                    <TeamMemberCard
                                        key={profile.id}
                                        member={profile}
                                        updating={updating}
                                        isMe={profile.id === user?.id}
                                        currentUserRole={currentUserRole}
                                        onToggleActive={toggleUserStatus}
                                        onChangeRole={handleRoleChange}
                                        onUpdateHourlyRate={handleHourlyRateChange}
                                        onDelete={removeUser}
                                    />
                                ))}
                            </div>
                            <button
                                className="btn btn-ghost btn-block mt-lg"
                                onClick={() => router.push('/admin')}
                            >
                                <ArrowLeft size={18} />
                                <span>Back to Admin</span>
                            </button>
                        </section>
                    )}
                </div>
            </main>
            <BottomNav />
        </>
    );
}
