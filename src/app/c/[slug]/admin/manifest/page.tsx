'use client';

import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Save, Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState, useCallback } from 'react';
import { User } from '@/lib/database.types';
import { useToast } from '@/context/ToastContext';

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

export default function StaffManifestPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const toast = useToast();

    const [staff, setStaff] = useState<User[]>([]);
    const [edits, setEdits] = useState<Record<string, Partial<User>>>({});
    const [loadingData, setLoadingData] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    const isOwner = profile?.role === 'owner';

    const fetchStaff = useCallback(async () => {
        try {
            const data = await jsonOrError(await fetch('/api/profiles')) as { users: User[] };
            const active = (data.users ?? []).filter(u => u.is_active);
            setStaff(active);
        } catch (err: unknown) {
            toast(`Error fetching staff: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setLoadingData(false);
        }
    }, [toast]);

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isOwner) { router.push('/admin'); return; }
        if (isOwner) fetchStaff();
    }, [loading, user, profile, isOwner, fetchStaff, router]);

    const handleInputChange = (userId: string, field: 'annual_leave_balance' | 'medical_leave_balance', value: string) => {
        const numValue = parseInt(value) || 0;
        setEdits(prev => ({
            ...prev,
            [userId]: {
                ...prev[userId],
                [field]: numValue
            }
        }));
    };

    const hasChanges = (userId: string) => !!edits[userId];

    const saveChanges = async (userId: string) => {
        const userEdits = edits[userId];
        if (!userEdits) return;

        setSaving(userId);
        try {
            const { user: updated } = await jsonOrError(await fetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userEdits),
            })) as { user: User };
            setStaff(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
            setEdits(prev => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
        } catch (err: unknown) {
            toast(`Failed to save changes: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        } finally {
            setSaving(null);
        }
    };

    if (loading || !profile || !isOwner) {
        return <div className="loading"><div className="spinner" /></div>;
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">LEAVE CONTROL</h1>
                        <p className="page-subtitle">STRICT BALANCE CONTROL // EDIT MODE ACTIVE</p>
                    </section>

                    {loadingData ? (
                        <div className="loading"><div className="spinner" /></div>
                    ) : (
                        <div className="animate-in">
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '2fr 1fr 1fr 0.5fr',
                                gap: 'var(--space-sm)',
                                borderBottom: '2px solid var(--color-black)',
                                paddingBottom: 'var(--space-sm)',
                                marginBottom: 'var(--space-sm)',
                                fontFamily: 'var(--font-heading)',
                                fontSize: '0.8rem',
                                letterSpacing: '0.05em'
                            }}>
                                <div>PERSONNEL</div>
                                <div style={{ textAlign: 'center' }}>ANNUAL</div>
                                <div style={{ textAlign: 'center' }}>MEDICAL</div>
                                <div style={{ textAlign: 'center' }}>SAVE</div>
                            </div>

                            {staff.map(member => {
                                const localEdit = edits[member.id];
                                const annual = localEdit?.annual_leave_balance ?? member.annual_leave_balance;
                                const medical = localEdit?.medical_leave_balance ?? member.medical_leave_balance;
                                const isDirty = hasChanges(member.id);
                                const isSaving = saving === member.id;

                                return (
                                    <div key={member.id} style={{
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1fr 1fr 0.5fr',
                                        gap: 'var(--space-sm)',
                                        alignItems: 'center',
                                        background: isDirty ? 'var(--color-bg-alt)' : 'transparent',
                                        padding: 'var(--space-sm) 0',
                                        borderBottom: '1px solid var(--color-concrete)'
                                    }}>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontFamily: 'var(--font-heading)', textTransform: 'uppercase' }}>
                                                {member.full_name}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                                {member.role}
                                            </div>
                                        </div>

                                        <div style={{ padding: '0 4px' }}>
                                            <input
                                                type="number"
                                                className="form-input"
                                                style={{
                                                    padding: '4px',
                                                    textAlign: 'center',
                                                    height: '36px',
                                                    background: localEdit?.annual_leave_balance !== undefined ? 'var(--color-white)' : 'transparent',
                                                    fontWeight: 'bold',
                                                    color: 'var(--color-black)'
                                                }}
                                                value={annual}
                                                onChange={(e) => handleInputChange(member.id, 'annual_leave_balance', e.target.value)}
                                            />
                                        </div>

                                        <div style={{ padding: '0 4px' }}>
                                            <input
                                                type="number"
                                                className="form-input"
                                                style={{
                                                    padding: '4px',
                                                    textAlign: 'center',
                                                    height: '36px',
                                                    background: localEdit?.medical_leave_balance !== undefined ? 'var(--color-white)' : 'transparent',
                                                    fontWeight: 'bold',
                                                    color: 'var(--color-black)'
                                                }}
                                                value={medical}
                                                onChange={(e) => handleInputChange(member.id, 'medical_leave_balance', e.target.value)}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                                            {isDirty && (
                                                <button
                                                    onClick={() => saveChanges(member.id)}
                                                    disabled={isSaving}
                                                    className="btn btn-primary"
                                                    style={{
                                                        padding: '6px 12px',
                                                        fontSize: '0.75rem',
                                                        height: '36px',
                                                        minWidth: '60px'
                                                    }}
                                                >
                                                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div style={{ marginTop: 'var(--space-xl)', borderTop: '2px solid var(--color-black)', paddingTop: 'var(--space-md)' }}>
                        <div className="flex items-center gap-sm text-muted" style={{ fontSize: '0.8rem' }}>
                            <AlertTriangle size={16} />
                            <span>Changes are saved immediately per row.</span>
                        </div>
                    </div>

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push('/admin')}
                    >
                        <ArrowLeft size={18} />
                        <span>Back to Command Center</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
