'use client';

import { createClient } from '@/lib/supabase';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { ArrowLeft, Save, Loader2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useState } from 'react';
import { User } from '@/lib/database.types';

export default function StaffManifestPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [staff, setStaff] = useState<User[]>([]);
    // Track local edits: { userId: { field: value } }
    const [edits, setEdits] = useState<Record<string, Partial<User>>>({});
    const [loadingData, setLoadingData] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/login');
        if (!loading && profile?.role !== 'owner') router.push('/admin');
    }, [loading, user?.id, profile?.role, router]);

    useEffect(() => {
        if (profile?.role === 'owner') {
            fetchStaff();
        }
    }, [profile?.role]);

    const fetchStaff = async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('is_active', true)
                .order('full_name', { ascending: true });

            if (error) {
                console.error('Error fetching staff:', error);
                alert(`Error fetching staff: ${error.message}`);
                return;
            }

            if (data) {
                setStaff(data as User[]);
            }
        } catch (err) {
            console.error('Unexpected error:', err);
            alert('Unexpected error fetching staff');
        } finally {
            setLoadingData(false);
        }
    };

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

    const hasChanges = (userId: string) => {
        return !!edits[userId];
    };

    const saveChanges = async (userId: string) => {
        const userEdits = edits[userId];
        if (!userEdits) return;

        setSaving(userId);

        const { error } = await supabase
            .from('profiles')
            .update(userEdits)
            .eq('id', userId);

        if (!error) {
            // Update local state
            setStaff(prev => prev.map(u => u.id === userId ? { ...u, ...userEdits } : u));
            // Clear edits for this user
            setEdits(prev => {
                const newEdits = { ...prev };
                delete newEdits[userId];
                return newEdits;
            });
        } else {
            alert('Failed to save changes');
        }
        setSaving(null);
    };

    if (loading || !profile || profile.role !== 'owner') {
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
                            {/* Manifest Header */}
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

                            {/* Manifest Rows */}
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

                                        {/* Save Button */}
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
                                                    {isSaving ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <>
                                                            <Save size={14} />
                                                        </>
                                                    )}
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
