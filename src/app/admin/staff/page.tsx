'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import { Users, Palmtree, Stethoscope, ArrowLeft, User as UserIcon, Minus, Plus, UserX, Trash2, UserCheck } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

export default function AdminStaffPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();
    const toast = useToast();

    const [staff, setStaff] = useState<User[]>([]);
    const [staffLoading, setStaffLoading] = useState(true);
    const [updating, setUpdating] = useState<string | null>(null);

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

    const updateRole = async (userId: string, newRole: 'owner' | 'manager' | 'staff') => {
        if (!confirm(`Are you sure you want to promote this user to ${newRole}?`)) return;
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

    const getRoleBadge = (role: User['role']) => {
        switch (role) {
            case 'owner':
                return { label: 'Owner', className: 'badge-success' };
            case 'manager':
                return { label: 'Manager', className: 'badge-info' };
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
                                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                                    {/* Promotion Button */}
                                                    {!isMemberOwner && !isCurrentUser && (
                                                        <button
                                                            onClick={() => updateRole(member.id, 'owner')}
                                                            className="btn btn-xs btn-outline"
                                                            style={{ fontSize: '0.7rem' }}
                                                        >
                                                            Make Owner
                                                        </button>
                                                    )}

                                                    {/* Disable/Enable Button */}
                                                    {!isCurrentUser && (
                                                        <button
                                                            onClick={() => toggleUserStatus(member.id, member.is_active)}
                                                            className={`btn btn-xs ${isDisabled ? 'btn-success' : 'btn-outline'}`}
                                                            style={{ fontSize: '0.7rem' }}
                                                            disabled={updating === member.id}
                                                        >
                                                            {isDisabled ? (
                                                                <>
                                                                    <UserCheck size={12} style={{ marginRight: '4px' }} />
                                                                    Enable
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <UserX size={12} style={{ marginRight: '4px' }} />
                                                                    Disable
                                                                </>
                                                            )}
                                                        </button>
                                                    )}

                                                    {/* Remove Button */}
                                                    {!isCurrentUser && (
                                                        <button
                                                            onClick={() => removeUser(member.id, member.full_name)}
                                                            className="btn btn-xs"
                                                            style={{ fontSize: '0.7rem', backgroundColor: '#ef4444', color: 'white' }}
                                                            disabled={updating === member.id}
                                                        >
                                                            <Trash2 size={12} style={{ marginRight: '4px' }} />
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

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
