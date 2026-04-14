'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Palmtree, Stethoscope, ArrowLeft, User as UserIcon, Minus, Plus, UserX, Trash2, UserCheck, UserPlus, Copy, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

export default function AdminStaffPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();
    const toast = useToast();

    const [staff, setStaff] = useState<User[]>([]);
    const [staffLoading, setStaffLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [editingRate, setEditingRate] = useState<string | null>(null); // userId being edited
    const [rateInput, setRateInput] = useState('');

    // Add-staff form state
    const [showAddForm, setShowAddForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newStaff, setNewStaff] = useState({
        full_name: '',
        email: '',
        phone: '',
        hourly_rate: '',
        role: 'staff' as User['role'],
    });
    const [createdCreds, setCreatedCreds] = useState<{ email: string; tempPassword: string } | null>(null);

    const isOwner = profile?.role === 'owner';

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        } else if (!loading && profile && !isOwner) {
            // Only owners can manage staff
            router.push('/admin');
        }
    }, [loading, user?.id, isOwner, router]); // Removed 'profile' dependency

    useEffect(() => {
        if (isOwner) {
            fetchStaff();
        }
    }, [isOwner]); // Removed 'profile' dependency

    const fetchStaff = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('full_name', { ascending: true });

        if (!error && data) {
            setStaff(data as User[]);
        }
        setStaffLoading(false);
    };

    const updateBalance = async (userId: string, field: 'annual_leave_balance' | 'medical_leave_balance', delta: number) => {
        setUpdating(userId);

        const member = staff.find(s => s.id === userId);
        if (!member) return;

        const currentValue = member[field];
        const newValue = Math.max(0, currentValue + delta);

        const { error } = await supabase
            .from('profiles')
            .update({ [field]: newValue })
            .eq('id', userId);

        if (!error) {
            setStaff(staff.map(s =>
                s.id === userId
                    ? { ...s, [field]: newValue }
                    : s
            ));
        }

        setUpdating(null);
    };

    const updateRole = async (userId: string, newRole: User['role']) => {
        const roleLabel = newRole === 'part_timer' ? 'Part-timer' : newRole.charAt(0).toUpperCase() + newRole.slice(1);
        if (!confirm(`Are you sure you want to change this user's role to ${roleLabel}?`)) return;
        setUpdating(userId);

        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (!error) {
            setStaff(staff.map(s =>
                s.id === userId
                    ? { ...s, role: newRole }
                    : s
            ));
        }
        setUpdating(null);
    };

    const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
        const action = currentStatus ? 'disable' : 'enable';
        if (!confirm(`Are you sure you want to ${action} this user? ${currentStatus ? 'They will not be able to access the system.' : 'They will regain access to the system.'}`)) return;

        setUpdating(userId);

        const { error } = await supabase
            .from('profiles')
            .update({ is_active: !currentStatus })
            .eq('id', userId);

        if (!error) {
            setStaff(staff.map(s =>
                s.id === userId
                    ? { ...s, is_active: !currentStatus }
                    : s
            ));
        } else {
            toast(`Failed to ${action} user: ${error.message}`, 'error');
        }
        setUpdating(null);
    };

    const removeUser = async (userId: string, userName: string) => {
        if (!confirm(`⚠️ WARNING: Are you sure you want to PERMANENTLY DELETE ${userName}?\n\nThis will:\n- Delete their profile\n- Remove all their leave requests\n- Remove all their task assignments\n\nThis action CANNOT be undone!`)) return;

        // Double confirmation for destructive action
        if (!confirm(`Final confirmation: Type DELETE in the next prompt to confirm deletion of ${userName}`)) return;

        setUpdating(userId);

        const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', userId);

        if (!error) {
            setStaff(staff.filter(s => s.id !== userId));
            toast(`${userName} has been removed from the system.`, 'success');
        } else {
            toast(`Failed to remove user: ${error.message}`, 'error');
        }
        setUpdating(null);
    };

    const saveHourlyRate = async (userId: string) => {
        const rate = parseFloat(rateInput);
        if (isNaN(rate) || rate <= 0) return;
        setUpdating(userId);
        const { error } = await supabase
            .from('profiles')
            .update({ hourly_rate: rate })
            .eq('id', userId);
        if (!error) {
            setStaff(staff.map(s => s.id === userId ? { ...s, hourly_rate: rate } : s));
            toast(`Hourly rate updated to S$${rate}/hr`, 'success');
        } else {
            toast(`Failed to update rate: ${error.message}`, 'error');
        }
        setEditingRate(null);
        setUpdating(null);
    };

    const createStaff = async () => {
        if (!newStaff.full_name.trim() || !newStaff.email.trim()) {
            toast('Name and email are required', 'error');
            return;
        }
        if (newStaff.role === 'part_timer' && !newStaff.hourly_rate) {
            toast('Hourly rate is required for part-timers', 'error');
            return;
        }
        setCreating(true);
        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token;
            if (!token) {
                toast('Session expired — please sign in again', 'error');
                setCreating(false);
                return;
            }
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    full_name: newStaff.full_name.trim(),
                    email: newStaff.email.trim(),
                    phone: newStaff.phone.trim() || null,
                    hourly_rate: newStaff.hourly_rate ? parseFloat(newStaff.hourly_rate) : null,
                    role: newStaff.role,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                toast(payload.error ?? 'Failed to create user', 'error');
                setCreating(false);
                return;
            }
            setCreatedCreds({ email: payload.email, tempPassword: payload.tempPassword });
            setNewStaff({ full_name: '', email: '', phone: '', hourly_rate: '', role: 'staff' });
            setShowAddForm(false);
            await fetchStaff();
            toast('Staff account created', 'success');
        } catch (e: unknown) {
            toast(e instanceof Error ? e.message : 'Failed to create user', 'error');
        } finally {
            setCreating(false);
        }
    };

    const copyCreds = async () => {
        if (!createdCreds) return;
        const text = `Email: ${createdCreds.email}\nTemporary password: ${createdCreds.tempPassword}`;
        try {
            await navigator.clipboard.writeText(text);
            toast('Copied to clipboard', 'success');
        } catch {
            toast('Copy failed', 'error');
        }
    };

    const getRoleBadge = (role: User['role']) => {
        switch (role) {
            case 'owner':
                return { label: 'Owner', className: 'badge-success' };
            case 'manager':
                return { label: 'Manager', className: 'badge-info' };
            case 'part_timer':
                return { label: 'Part-timer', className: 'badge-info' };
            default:
                return { label: 'Staff', className: 'badge-neutral' };
        }
    };

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    if (loading || !user || !profile || !isOwner) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Staff Management</h1>
                        <p className="page-subtitle">Manage leave balances for your team</p>
                    </section>

                    {/* Add Staff */}
                    <section className="section animate-in">
                        {!showAddForm ? (
                            <button
                                className="btn btn-primary btn-block"
                                onClick={() => setShowAddForm(true)}
                            >
                                <UserPlus size={18} />
                                <span>Add Staff</span>
                            </button>
                        ) : (
                            <div className="card">
                                <div className="flex items-center justify-between mb-md">
                                    <div className="card-title">New Staff Account</div>
                                    <button
                                        onClick={() => setShowAddForm(false)}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                        aria-label="Close"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div>
                                        <label className="form-label">Full name *</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newStaff.full_name}
                                            onChange={e => setNewStaff({ ...newStaff, full_name: e.target.value })}
                                            placeholder="e.g. Ahkow"
                                            disabled={creating}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Email *</label>
                                        <input
                                            type="email"
                                            className="form-input"
                                            value={newStaff.email}
                                            onChange={e => setNewStaff({ ...newStaff, email: e.target.value })}
                                            placeholder="staff@example.com"
                                            disabled={creating}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Phone</label>
                                        <input
                                            type="tel"
                                            className="form-input"
                                            value={newStaff.phone}
                                            onChange={e => setNewStaff({ ...newStaff, phone: e.target.value })}
                                            placeholder="Optional"
                                            disabled={creating}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">Role</label>
                                        <select
                                            className="form-input"
                                            value={newStaff.role}
                                            onChange={e => setNewStaff({ ...newStaff, role: e.target.value as User['role'] })}
                                            disabled={creating}
                                        >
                                            <option value="staff">Staff</option>
                                            <option value="manager">Manager</option>
                                            <option value="part_timer">Part-timer</option>
                                            <option value="owner">Owner</option>
                                        </select>
                                    </div>
                                    {newStaff.role === 'part_timer' && (
                                        <div>
                                            <label className="form-label">Hourly rate (S$) *</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.50"
                                                className="form-input"
                                                value={newStaff.hourly_rate}
                                                onChange={e => setNewStaff({ ...newStaff, hourly_rate: e.target.value })}
                                                placeholder="e.g. 10"
                                                disabled={creating}
                                            />
                                        </div>
                                    )}
                                    <button
                                        className="btn btn-primary btn-block"
                                        onClick={createStaff}
                                        disabled={creating}
                                    >
                                        {creating ? 'Creating…' : 'Create Account'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Credentials display — shown once after creation */}
                    {createdCreds && (
                        <section className="section animate-in">
                            <div className="card" style={{ border: '2px solid var(--color-primary)' }}>
                                <div className="card-title">Account Created</div>
                                <p className="card-subtitle mb-md">
                                    Share these credentials with the new staff member. They will not be shown again.
                                </p>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                    <div><strong>Email:</strong> {createdCreds.email}</div>
                                    <div><strong>Temp password:</strong> {createdCreds.tempPassword}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button className="btn btn-outline" onClick={copyCreds}>
                                        <Copy size={14} /> <span>Copy</span>
                                    </button>
                                    <button className="btn btn-ghost" onClick={() => setCreatedCreds(null)}>
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}

                    {staffLoading ? (
                        <div className="loading">
                            <div className="spinner" />
                        </div>
                    ) : staff.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon">
                                <UserIcon size={48} />
                            </div>
                            <div className="empty-state-title">No staff yet</div>
                            <p>Staff will appear here once they sign up</p>
                        </div>
                    ) : (
                        <section className="section animate-in">
                            {staff.map(member => {
                                const roleBadge = getRoleBadge(member.role);
                                const isMemberOwner = member.role === 'owner';
                                const isCurrentUser = member.id === user?.id;
                                const isDisabled = member.is_active === false;

                                return (
                                    <div
                                        key={member.id}
                                        className="staff-card"
                                        style={{
                                            opacity: updating === member.id ? 0.7 : (isDisabled ? 0.6 : 1),
                                            border: isDisabled ? '2px solid #ef4444' : undefined
                                        }}
                                    >
                                        <div className="staff-header">
                                            <div className="staff-avatar" style={{
                                                backgroundColor: isDisabled ? '#6b7280' : undefined
                                            }}>
                                                {getInitials(member.full_name)}
                                            </div>
                                            <div className="staff-info">
                                                <div className="staff-name">
                                                    {member.full_name}
                                                    <span className={`badge ${roleBadge.className}`} style={{ marginLeft: '0.5rem' }}>
                                                        {roleBadge.label}
                                                    </span>
                                                    {isDisabled && (
                                                        <span className="badge" style={{ marginLeft: '0.5rem', backgroundColor: '#ef4444', color: 'white' }}>
                                                            Disabled
                                                        </span>
                                                    )}
                                                    {isCurrentUser && (
                                                        <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>
                                                            You
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="staff-email">{member.email}</div>

                                                {/* Action Buttons */}
                                                {!isCurrentUser && (
                                                    <div style={{ marginTop: '0.5rem' }}>
                                                        {/* Role assignment — not shown for owner members or current user */}
                                                        {!isMemberOwner && (
                                                            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                                                <button
                                                                    onClick={() => updateRole(member.id, 'staff')}
                                                                    disabled={member.role === 'staff' || !!updating}
                                                                    className={`btn btn-xs ${member.role === 'staff' ? 'btn-ghost' : 'btn-outline'}`}
                                                                    style={{ fontSize: '0.7rem' }}
                                                                >
                                                                    Staff
                                                                </button>
                                                                <button
                                                                    onClick={() => updateRole(member.id, 'manager')}
                                                                    disabled={member.role === 'manager' || !!updating}
                                                                    className={`btn btn-xs ${member.role === 'manager' ? 'btn-ghost' : 'btn-outline'}`}
                                                                    style={{ fontSize: '0.7rem' }}
                                                                >
                                                                    Manager
                                                                </button>
                                                                <button
                                                                    onClick={() => updateRole(member.id, 'part_timer')}
                                                                    disabled={member.role === 'part_timer' || !!updating}
                                                                    className={`btn btn-xs ${member.role === 'part_timer' ? 'btn-ghost' : 'btn-outline'}`}
                                                                    style={{ fontSize: '0.7rem' }}
                                                                >
                                                                    Part-timer
                                                                </button>
                                                                <button
                                                                    onClick={() => updateRole(member.id, 'owner')}
                                                                    disabled={member.role === 'owner' || !!updating}
                                                                    className={`btn btn-xs ${member.role === 'owner' ? 'btn-ghost' : 'btn-outline'}`}
                                                                    style={{ fontSize: '0.7rem' }}
                                                                >
                                                                    Owner
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                            <button
                                                                onClick={() => toggleUserStatus(member.id, member.is_active)}
                                                                className={`btn btn-xs ${isDisabled ? 'btn-success' : 'btn-outline'}`}
                                                                style={{ fontSize: '0.7rem' }}
                                                                disabled={!!updating}
                                                            >
                                                                {isDisabled ? (
                                                                    <><UserCheck size={12} style={{ marginRight: '4px' }} />Enable</>
                                                                ) : (
                                                                    <><UserX size={12} style={{ marginRight: '4px' }} />Disable</>
                                                                )}
                                                            </button>
                                                            <button
                                                                onClick={() => removeUser(member.id, member.full_name)}
                                                                className="btn btn-xs"
                                                                style={{ fontSize: '0.7rem', backgroundColor: '#ef4444', color: 'white' }}
                                                                disabled={!!updating}
                                                            >
                                                                <Trash2 size={12} style={{ marginRight: '4px' }} />
                                                                Remove
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Hourly rate — part-timers only */}
                                        {member.role === 'part_timer' && (
                                            <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--color-concrete)' }}>
                                                {editingRate === member.id ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>S$</span>
                                                        <input
                                                            type="number"
                                                            value={rateInput}
                                                            onChange={e => setRateInput(e.target.value)}
                                                            min="0"
                                                            step="0.50"
                                                            placeholder="e.g. 10"
                                                            autoFocus
                                                            style={{ width: 80, border: '1px solid var(--color-black)', padding: '3px 6px', fontSize: '0.85rem', borderRadius: 0 }}
                                                        />
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>/hr</span>
                                                        <button onClick={() => saveHourlyRate(member.id)} className="btn btn-xs btn-primary" disabled={!!updating}>Save</button>
                                                        <button onClick={() => setEditingRate(null)} className="btn btn-xs btn-outline">Cancel</button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                                        <span style={{ color: 'var(--color-gray)' }}>Hourly Rate:</span>
                                                        <span style={{ fontWeight: 600 }}>
                                                            {member.hourly_rate ? `S$${member.hourly_rate}/hr` : 'Not set'}
                                                        </span>
                                                        <button
                                                            onClick={() => { setRateInput(member.hourly_rate?.toString() ?? ''); setEditingRate(member.id); }}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.8rem', textDecoration: 'underline', padding: 0 }}
                                                            disabled={!!updating}
                                                        >
                                                            {member.hourly_rate ? 'Edit' : 'Set rate'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="balance-controls">
                                            {/* Annual Leave */}
                                            <div className="balance-control">
                                                <div className="balance-label">
                                                    <Palmtree size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                                    Annual Leave
                                                </div>
                                                <div className="balance-input-group">
                                                    <button
                                                        className="balance-btn"
                                                        onClick={() => updateBalance(member.id, 'annual_leave_balance', -1)}
                                                        disabled={member.annual_leave_balance <= 0}
                                                    >
                                                        <Minus size={16} />
                                                    </button>
                                                    <div className="balance-value">{member.annual_leave_balance}</div>
                                                    <button
                                                        className="balance-btn"
                                                        onClick={() => updateBalance(member.id, 'annual_leave_balance', 1)}
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Medical Leave */}
                                            <div className="balance-control">
                                                <div className="balance-label">
                                                    <Stethoscope size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                                    Medical Leave
                                                </div>
                                                <div className="balance-input-group">
                                                    <button
                                                        className="balance-btn"
                                                        onClick={() => updateBalance(member.id, 'medical_leave_balance', -1)}
                                                        disabled={member.medical_leave_balance <= 0}
                                                    >
                                                        <Minus size={16} />
                                                    </button>
                                                    <div className="balance-value">{member.medical_leave_balance}</div>
                                                    <button
                                                        className="balance-btn"
                                                        onClick={() => updateBalance(member.id, 'medical_leave_balance', 1)}
                                                    >
                                                        <Plus size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </section>
                    )}

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push('/admin')}
                    >
                        <ArrowLeft size={18} />
                        <span>Back to Admin</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
