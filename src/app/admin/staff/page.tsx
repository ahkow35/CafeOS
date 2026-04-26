'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Palmtree, Stethoscope, ArrowLeft, User as UserIcon, Minus, Plus, UserX, Trash2, UserCheck, UserPlus, Copy, X, KeyRound } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

type StaffRow = Pick<
    User,
    | 'id'
    | 'phone_e164'
    | 'full_name'
    | 'job_title'
    | 'role'
    | 'annual_leave_balance'
    | 'medical_leave_balance'
    | 'is_active'
    | 'hourly_rate'
    | 'email'
    | 'created_at'
>;

async function jsonOrError(res: Response): Promise<{ ok: boolean; data: unknown; error?: string }> {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, data, error: (data.error as string) ?? `Request failed (${res.status})` };
    return { ok: true, data };
}

export default function AdminStaffPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const toast = useToast();

    const [staff, setStaff] = useState<StaffRow[]>([]);
    const [staffLoading, setStaffLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);
    const [editingRate, setEditingRate] = useState<string | null>(null);
    const [rateInput, setRateInput] = useState('');

    // Add-staff form state
    const [showAddForm, setShowAddForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newStaff, setNewStaff] = useState({
        full_name: '',
        phone: '',
        job_title: '',
        pin: '',
        hourly_rate: '',
        role: 'staff' as User['role'],
    });
    const [createdCreds, setCreatedCreds] = useState<{ phone: string; tempPin: string; name: string } | null>(null);

    const isOwner = profile?.role === 'owner';

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isOwner) router.push('/admin');
    }, [loading, user, profile, isOwner, router]);

    const fetchStaff = useCallback(async () => {
        const res = await fetch('/api/admin/users', { cache: 'no-store' });
        const { ok, data, error } = await jsonOrError(res);
        if (ok) {
            setStaff(((data as { users: StaffRow[] }).users) ?? []);
        } else {
            toast(error ?? 'Failed to load staff', 'error');
        }
        setStaffLoading(false);
    }, [toast]);

    useEffect(() => {
        if (isOwner) fetchStaff();
    }, [isOwner, fetchStaff]);

    const patchUser = async (
        userId: string,
        body: Record<string, unknown>,
        opts?: { successToast?: string; errorPrefix?: string },
    ): Promise<StaffRow | null> => {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const { ok, data, error } = await jsonOrError(res);
        if (!ok) {
            toast(`${opts?.errorPrefix ?? 'Update failed'}: ${error}`, 'error');
            return null;
        }
        if (opts?.successToast) toast(opts.successToast, 'success');
        return (data as { user: StaffRow }).user;
    };

    const updateBalance = async (
        userId: string,
        field: 'annual_leave_balance' | 'medical_leave_balance',
        delta: number,
    ) => {
        const member = staff.find(s => s.id === userId);
        if (!member) return;
        const next = Math.max(0, member[field] + delta);
        if (next === member[field]) return;
        setUpdating(userId);
        const updated = await patchUser(userId, { [field]: next }, { errorPrefix: 'Failed to update balance' });
        if (updated) setStaff(staff.map(s => (s.id === userId ? { ...s, [field]: updated[field] } : s)));
        setUpdating(null);
    };

    const updateRole = async (userId: string, newRole: User['role']) => {
        const roleLabel = newRole === 'part_timer' ? 'Part-timer' : newRole.charAt(0).toUpperCase() + newRole.slice(1);
        if (!confirm(`Are you sure you want to change this user's role to ${roleLabel}?`)) return;
        setUpdating(userId);
        const updated = await patchUser(userId, { role: newRole }, { errorPrefix: 'Failed to change role' });
        if (updated) setStaff(staff.map(s => (s.id === userId ? { ...s, role: updated.role } : s)));
        setUpdating(null);
    };

    const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
        const action = currentStatus ? 'disable' : 'enable';
        if (!confirm(`Are you sure you want to ${action} this user? ${currentStatus ? 'They will not be able to access the system.' : 'They will regain access to the system.'}`)) return;
        setUpdating(userId);
        const updated = await patchUser(
            userId,
            { is_active: !currentStatus },
            { errorPrefix: `Failed to ${action} user` },
        );
        if (updated) setStaff(staff.map(s => (s.id === userId ? { ...s, is_active: updated.is_active } : s)));
        setUpdating(null);
    };

    const removeUser = async (userId: string, userName: string) => {
        if (!confirm(`⚠️ WARNING: Are you sure you want to PERMANENTLY DELETE ${userName}?\n\nThis will:\n- Delete their profile\n- Remove all their leave requests\n- Remove all their task assignments\n\nThis action CANNOT be undone!`)) return;
        if (!confirm(`Final confirmation: delete ${userName}? This cannot be undone.`)) return;

        setUpdating(userId);
        const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        const { ok, error } = await jsonOrError(res);
        if (ok) {
            setStaff(staff.filter(s => s.id !== userId));
            toast(`${userName} has been removed from the system.`, 'success');
        } else {
            toast(`Failed to remove user: ${error}`, 'error');
        }
        setUpdating(null);
    };

    const saveHourlyRate = async (userId: string) => {
        const rate = parseFloat(rateInput);
        if (isNaN(rate) || rate <= 0) return;
        setUpdating(userId);
        const updated = await patchUser(
            userId,
            { hourly_rate: rate },
            { errorPrefix: 'Failed to update rate', successToast: `Hourly rate updated to S$${rate}/hr` },
        );
        if (updated) setStaff(staff.map(s => (s.id === userId ? { ...s, hourly_rate: updated.hourly_rate } : s)));
        setEditingRate(null);
        setUpdating(null);
    };

    const resetPin = async (userId: string, userName: string) => {
        if (!confirm(`Generate a new PIN for ${userName}? Their old PIN will stop working immediately.`)) return;
        setUpdating(userId);
        const res = await fetch(`/api/admin/users/${userId}/reset-pin`, { method: 'POST' });
        const { ok, data, error } = await jsonOrError(res);
        if (ok) {
            const member = staff.find(s => s.id === userId);
            setCreatedCreds({
                phone: member?.phone_e164 ?? '',
                tempPin: (data as { tempPin: string }).tempPin,
                name: userName,
            });
            toast('PIN reset — share the new PIN with the user', 'success');
        } else {
            toast(`Failed to reset PIN: ${error}`, 'error');
        }
        setUpdating(null);
    };

    const createStaff = async () => {
        if (!newStaff.full_name.trim() || !newStaff.phone.trim() || !newStaff.pin.trim()) {
            toast('Name, phone, and PIN are required', 'error');
            return;
        }
        if (!/^\d{6}$/.test(newStaff.pin.trim())) {
            toast('PIN must be exactly 6 digits', 'error');
            return;
        }
        if (newStaff.role === 'part_timer' && !newStaff.hourly_rate) {
            toast('Hourly rate is required for part-timers', 'error');
            return;
        }
        setCreating(true);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: newStaff.full_name.trim(),
                    phone: '+65' + newStaff.phone.trim(),
                    job_title: newStaff.job_title.trim() || null,
                    pin: newStaff.pin.trim(),
                    hourly_rate: newStaff.hourly_rate ? parseFloat(newStaff.hourly_rate) : null,
                    role: newStaff.role,
                }),
            });
            const { ok, data, error } = await jsonOrError(res);
            if (!ok) {
                toast(error ?? 'Failed to create user', 'error');
                return;
            }
            const payload = data as { phone_e164: string; tempPin: string; full_name: string };
            setCreatedCreds({ phone: payload.phone_e164, tempPin: payload.tempPin, name: payload.full_name });
            setNewStaff({ full_name: '', phone: '', job_title: '', pin: '', hourly_rate: '', role: 'staff' });
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
        const text = `Hi ${createdCreds.name}! 👋\n\nYour CafeOS login details:\n📱 Mobile: ${createdCreds.phone}\n🔑 PIN: ${createdCreds.tempPin}\n\nLogin at: https://cafe-os-six.vercel.app/login`;
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
                                        <label className="form-label">Mobile number *</label>
                                        <div style={{ display: 'flex' }}>
                                            <span className="form-input" style={{ width: 'auto', padding: '0 12px', borderRight: 'none', color: 'var(--color-text-muted)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                                +65
                                            </span>
                                            <input
                                                type="tel"
                                                inputMode="numeric"
                                                maxLength={8}
                                                className="form-input"
                                                style={{ borderLeft: 'none', flex: 1 }}
                                                value={newStaff.phone}
                                                onChange={e => setNewStaff({ ...newStaff, phone: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                                                placeholder="91234567"
                                                disabled={creating}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="form-label">Job title</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={newStaff.job_title}
                                            onChange={e => setNewStaff({ ...newStaff, job_title: e.target.value })}
                                            placeholder="e.g. Barista"
                                            disabled={creating}
                                        />
                                    </div>
                                    <div>
                                        <label className="form-label">6-digit PIN *</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="\d{6}"
                                            maxLength={6}
                                            className="form-input"
                                            value={newStaff.pin}
                                            onChange={e => setNewStaff({ ...newStaff, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                            placeholder="123456"
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

                    {/* Credentials display — shown once after creation or PIN reset */}
                    {createdCreds && (
                        <section className="section animate-in">
                            <div className="card" style={{ border: '2px solid var(--color-primary)' }}>
                                <div className="card-title">Credentials</div>
                                <p className="card-subtitle mb-md">
                                    Share these with {createdCreds.name}. They will not be shown again.
                                </p>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                                    <div><strong>Phone:</strong> {createdCreds.phone}</div>
                                    <div><strong>PIN:</strong> {createdCreds.tempPin}</div>
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
                            <p>Add your first staff member above</p>
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
                                                <div className="staff-email">
                                                    {member.phone_e164}
                                                    {member.job_title ? ` · ${member.job_title}` : ''}
                                                </div>

                                                {/* Action Buttons */}
                                                {!isCurrentUser && (
                                                    <div style={{ marginTop: '0.5rem' }}>
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
                                                                onClick={() => resetPin(member.id, member.full_name)}
                                                                className="btn btn-xs btn-outline"
                                                                style={{ fontSize: '0.7rem' }}
                                                                disabled={!!updating}
                                                            >
                                                                <KeyRound size={12} style={{ marginRight: '4px' }} />
                                                                Reset PIN
                                                            </button>
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
