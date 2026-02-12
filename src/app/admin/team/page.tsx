'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Shield, ShieldAlert, Users, ArrowLeft, Check, UserX, Trash2, UserCheck, Edit } from 'lucide-react';

export default function ManageTeamPage() {
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);

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
                console.error('Profile Role Check Error:', profileError);
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
                .select('id, full_name, email, role, is_active')
                .order('full_name', { ascending: true });

            if (fetchError) {
                console.error('Team Fetch Error:', fetchError);
                setError(`Team fetch failed: ${fetchError.message}`);
                return;
            }

            setProfiles((allProfiles || []) as User[]);

        } catch (err: unknown) {
            console.error('Unexpected Error loading team:', err);
            const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const handleRoleChange = async (targetUserId: string, newRole: 'staff' | 'manager') => {
        if (targetUserId === user?.id) {
            alert("You cannot change your own role.");
            return;
        }

        const confirmUpdate = window.confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`);
        if (!confirmUpdate) return;

        setUpdating(targetUserId);
        try {
            const { error } = await supabase
                .from('profiles')
                .update({ role: newRole })
                .eq('id', targetUserId);

            if (error) throw error;

            setProfiles(prev => prev.map(p =>
                p.id === targetUserId ? { ...p, role: newRole } : p
            ));

            alert(`Role updated to ${newRole.toUpperCase()}!`);
        } catch (error: unknown) {
            console.error('Error updating role:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            alert(`Failed to update role: ${errorMessage}`);
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
            alert(`User ${action}d successfully!`);
        } else {
            alert(`Failed to ${action} user: ${error.message}`);
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
            alert(`${userName} has been removed from the system.`);
        } else {
            alert(`Failed to remove user: ${error.message}`);
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
                            {/* Desktop Table View */}
                            <div className="desktop-view" style={{ display: 'none' }}>
                                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--color-concrete)', textAlign: 'left' }}>
                                                    <th style={{ padding: '1rem', fontSize: '0.85rem', width: '30%' }}>USER</th>
                                                    <th style={{ padding: '1rem', fontSize: '0.85rem', width: '15%' }}>STATUS</th>
                                                    <th style={{ padding: '1rem', fontSize: '0.85rem', width: '15%' }}>ROLE</th>
                                                    <th style={{ padding: '1rem', fontSize: '0.85rem', width: '40%' }}>ACTIONS</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {profiles.map(profile => {
                                                    const isMe = profile.id === user?.id;
                                                    const isOwner = profile.role === 'owner';
                                                    const isDisabled = profile.is_active === false;

                                                    return (
                                                        <tr key={profile.id} style={{
                                                            borderBottom: '1px solid var(--color-concrete)',
                                                            opacity: isDisabled ? 0.6 : 1,
                                                            backgroundColor: isDisabled ? '#fee2e2' : undefined
                                                        }}>
                                                            <td style={{ padding: '1rem' }}>
                                                                <div style={{ fontWeight: 'bold' }}>
                                                                    {profile.full_name || 'Unknown'}
                                                                    {isMe && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>(You)</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{profile.email}</div>
                                                            </td>
                                                            <td style={{ padding: '1rem' }}>
                                                                {isDisabled ? (
                                                                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#fee2e2', color: '#dc2626' }}>DISABLED</span>
                                                                ) : (
                                                                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#dcfce7', color: '#16a34a' }}>ACTIVE</span>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '1rem' }}>
                                                                <span style={{
                                                                    padding: '0.25rem 0.5rem',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 'bold',
                                                                    textTransform: 'uppercase',
                                                                    backgroundColor: profile.role === 'owner' ? '#fef3c7' : profile.role === 'manager' ? '#f3e8ff' : '#dcfce7',
                                                                    color: profile.role === 'owner' ? '#b45309' : profile.role === 'manager' ? '#7e22ce' : '#15803d'
                                                                }}>{profile.role}</span>
                                                            </td>
                                                            <td style={{ padding: '1rem' }}>
                                                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', opacity: updating === profile.id ? 0.5 : 1 }}>
                                                                    {!isOwner && (
                                                                        <>
                                                                            <button
                                                                                onClick={() => handleRoleChange(profile.id, 'staff')}
                                                                                disabled={profile.role === 'staff' || !!updating || isMe}
                                                                                className={`btn btn-xs ${profile.role === 'staff' ? 'btn-ghost' : 'btn-outline'}`}
                                                                                style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', padding: '0.35rem 0.6rem' }}
                                                                            >
                                                                                Staff
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleRoleChange(profile.id, 'manager')}
                                                                                disabled={profile.role === 'manager' || !!updating || isMe}
                                                                                className={`btn btn-xs ${profile.role === 'manager' ? 'btn-ghost' : 'btn-outline'}`}
                                                                                style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', padding: '0.35rem 0.6rem' }}
                                                                            >
                                                                                Manager
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                    {!isMe && (
                                                                        <>
                                                                            <button
                                                                                onClick={() => toggleUserStatus(profile.id, profile.is_active)}
                                                                                className={`btn btn-xs ${isDisabled ? 'btn-success' : 'btn-outline'}`}
                                                                                style={{ padding: '0.35rem 0.45rem', minWidth: '36px' }}
                                                                                disabled={!!updating}
                                                                                title={isDisabled ? 'Enable' : 'Disable'}
                                                                            >
                                                                                {isDisabled ? <UserCheck size={14} /> : <UserX size={14} />}
                                                                            </button>
                                                                            <button
                                                                                onClick={() => removeUser(profile.id, profile.full_name)}
                                                                                className="btn btn-xs"
                                                                                style={{ backgroundColor: '#ef4444', color: 'white', padding: '0.35rem 0.45rem', minWidth: '36px' }}
                                                                                disabled={!!updating}
                                                                                title="Delete"
                                                                            >
                                                                                <Trash2 size={14} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>


                            {/* Mobile Card View */}
                            <div className="mobile-view" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {profiles.map(profile => {
                                    const isMe = profile.id === user?.id;
                                    const isOwner = profile.role === 'owner';
                                    const isDisabled = profile.is_active === false;

                                    return (
                                        <div
                                            key={profile.id}
                                            className="card"
                                            style={{
                                                padding: '1rem',
                                                opacity: isDisabled ? 0.6 : 1,
                                                backgroundColor: isDisabled ? '#fee2e2' : undefined
                                            }}
                                        >
                                            <div style={{ marginBottom: '0.75rem' }}>
                                                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                                                    {profile.full_name || 'Unknown'}
                                                    {isMe && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>(You)</span>}
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{profile.email}</div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                                                {isDisabled ? (
                                                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#fee2e2', color: '#dc2626' }}>DISABLED</span>
                                                ) : (
                                                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#dcfce7', color: '#16a34a' }}>ACTIVE</span>
                                                )}
                                                <span style={{
                                                    padding: '0.25rem 0.5rem',
                                                    borderRadius: '4px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 'bold',
                                                    textTransform: 'uppercase',
                                                    backgroundColor: profile.role === 'owner' ? '#fef3c7' : profile.role === 'manager' ? '#f3e8ff' : '#dcfce7',
                                                    color: profile.role === 'owner' ? '#b45309' : profile.role === 'manager' ? '#7e22ce' : '#15803d'
                                                }}>{profile.role}</span>
                                            </div>

                                            {!isMe && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: updating === profile.id ? 0.5 : 1 }}>
                                                    {!isOwner && (
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            <button
                                                                onClick={() => handleRoleChange(profile.id, 'staff')}
                                                                disabled={profile.role === 'staff' || !!updating}
                                                                className={`btn btn-sm ${profile.role === 'staff' ? 'btn-ghost' : 'btn-outline'}`}
                                                                style={{ flex: 1, fontSize: '0.8rem' }}
                                                            >
                                                                <Edit size={14} style={{ marginRight: '4px' }} />
                                                                Staff
                                                            </button>
                                                            <button
                                                                onClick={() => handleRoleChange(profile.id, 'manager')}
                                                                disabled={profile.role === 'manager' || !!updating}
                                                                className={`btn btn-sm ${profile.role === 'manager' ? 'btn-ghost' : 'btn-outline'}`}
                                                                style={{ flex: 1, fontSize: '0.8rem' }}
                                                            >
                                                                <Edit size={14} style={{ marginRight: '4px' }} />
                                                                Manager
                                                            </button>
                                                        </div>
                                                    )}
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            onClick={() => toggleUserStatus(profile.id, profile.is_active)}
                                                            className={`btn btn-sm ${isDisabled ? 'btn-success' : 'btn-outline'}`}
                                                            style={{ flex: 1, fontSize: '0.8rem' }}
                                                            disabled={!!updating}
                                                        >
                                                            {isDisabled ? <UserCheck size={14} style={{ marginRight: '4px' }} /> : <UserX size={14} style={{ marginRight: '4px' }} />}
                                                            {isDisabled ? 'Enable' : 'Disable'}
                                                        </button>
                                                        <button
                                                            onClick={() => removeUser(profile.id, profile.full_name)}
                                                            className="btn btn-sm"
                                                            style={{ flex: 1, fontSize: '0.8rem', backgroundColor: '#ef4444', color: 'white' }}
                                                            disabled={!!updating}
                                                        >
                                                            <Trash2 size={14} style={{ marginRight: '4px' }} />
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
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

            <style jsx>{`
                @media (min-width: 768px) {
                    .desktop-view {
                        display: block !important;
                    }
                    .mobile-view {
                        display: none !important;
                    }
                }
                @media (max-width: 767px) {
                    .desktop-view {
                        display: none !important;
                    }
                    .mobile-view {
                        display: flex !important;
                    }
                }
            `}</style>
        </>
    );
}
