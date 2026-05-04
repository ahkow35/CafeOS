'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import TeamMemberCard from '@/components/TeamMemberCard';

async function jsonOrError(res: Response): Promise<unknown> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return res.json();
}

export default function ManageTeamPage() {
    const { user, profile, loading: authLoading } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [profiles, setProfiles] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<string | null>(null);

    const isOwner = profile?.role === 'owner';

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await jsonOrError(await fetch('/api/profiles')) as { users: User[] };
            setProfiles(data.users ?? []);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isOwner) { router.push(`/c/${slug}/admin`); return; }
        if (isOwner) loadData();
    }, [user, profile, authLoading, isOwner, loadData, router]);

    const patchUser = async (targetUserId: string, body: Record<string, unknown>) => {
        return jsonOrError(await fetch(`/api/admin/users/${targetUserId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })) as Promise<{ user: User }>;
    };

    const handleHourlyRateChange = async (targetUserId: string, rate: number) => {
        setUpdating(targetUserId);
        try {
            const { user: updated } = await patchUser(targetUserId, { hourly_rate: rate });
            setProfiles(prev => prev.map(p => p.id === targetUserId ? { ...p, hourly_rate: updated.hourly_rate } : p));
            toast(`Hourly rate updated to S$${rate}/hr`, 'success');
        } catch (err: unknown) {
            toast(`Failed to update rate: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    const handleRoleChange = async (targetUserId: string, newRole: string) => {
        if (targetUserId === user?.id) {
            toast("You cannot change your own role.", 'error');
            return;
        }
        if (!window.confirm(`Are you sure you want to change this user's role to ${newRole.toUpperCase()}?`)) return;

        setUpdating(targetUserId);
        try {
            const { user: updated } = await patchUser(targetUserId, { role: newRole });
            setProfiles(prev => prev.map(p => p.id === targetUserId ? { ...p, role: updated.role } : p));
            toast(`Role updated to ${newRole.toUpperCase()}!`, 'success');
        } catch (err: unknown) {
            toast(`Failed to update role: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
        const action = currentStatus ? 'disable' : 'enable';
        if (!confirm(`Are you sure you want to ${action} this user?`)) return;

        setUpdating(userId);
        try {
            const { user: updated } = await patchUser(userId, { is_active: !currentStatus });
            setProfiles(prev => prev.map(p => p.id === userId ? { ...p, is_active: updated.is_active } : p));
            toast(`User ${action}d successfully!`, 'success');
        } catch (err: unknown) {
            toast(`Failed to ${action} user: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    const removeUser = async (userId: string, userName: string) => {
        if (!confirm(`WARNING: Are you sure you want to PERMANENTLY DELETE ${userName}? This action CANNOT be undone!`)) return;

        setUpdating(userId);
        try {
            await jsonOrError(await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' }));
            setProfiles(prev => prev.filter(p => p.id !== userId));
            toast(`${userName} has been removed from the system.`, 'success');
        } catch (err: unknown) {
            toast(`Failed to remove user: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setUpdating(null);
        }
    };

    if (authLoading || loading) {
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
                                {profiles.map(p => (
                                    <TeamMemberCard
                                        key={p.id}
                                        member={p}
                                        updating={updating}
                                        isMe={p.id === user?.id}
                                        currentUserRole={profile?.role ?? ''}
                                        onToggleActive={toggleUserStatus}
                                        onChangeRole={handleRoleChange}
                                        onUpdateHourlyRate={handleHourlyRateChange}
                                        onDelete={removeUser}
                                    />
                                ))}
                            </div>
                            <button
                                className="btn btn-ghost btn-block mt-lg"
                                onClick={() => router.push(`/c/${slug}/admin`)}
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
