'use client';

import { useState } from 'react';
import { User } from '@/lib/database.types';
import { Edit, UserCheck, UserX, Trash2 } from 'lucide-react';

interface TeamMemberCardProps {
    member: User;
    updating: string | null;
    isMe: boolean;
    currentUserRole: string;
    onToggleActive: (id: string, isActive: boolean) => Promise<void>;
    onChangeRole: (id: string, newRole: string) => Promise<void>;
    onUpdateHourlyRate: (id: string, rate: number) => Promise<void>;
    onDelete: (id: string, name: string) => Promise<void>;
}

function HourlyRateField({
    currentRate,
    disabled,
    onSave,
}: {
    currentRate: number | null;
    disabled: boolean;
    onSave: (rate: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(currentRate?.toString() ?? '');

    function save() {
        const rate = parseFloat(value);
        if (isNaN(rate) || rate <= 0) return;
        onSave(rate);
        setEditing(false);
    }

    if (!editing) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--color-status-neutral-text)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Hourly Rate:</span>
                <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{currentRate ? `S$${currentRate}/hr` : 'Not set'}</span>
                <button
                    onClick={() => { setValue(currentRate?.toString() ?? ''); setEditing(true); }}
                    disabled={disabled}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.8rem', textDecoration: 'underline', padding: 0 }}
                >
                    {currentRate ? 'Edit' : 'Set rate'}
                </button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>S$</span>
            <input
                type="number"
                value={value}
                onChange={e => setValue(e.target.value)}
                min="0"
                step="0.50"
                placeholder="e.g. 10"
                style={{ width: 80, border: 'var(--border-width-thin) solid var(--color-border-subtle)', borderRadius: 'var(--radius-6)', padding: '0.3rem 0.5rem', fontSize: '0.9rem' }}
                autoFocus
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>/hr</span>
            <button onClick={save} className="btn btn-sm btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>Save</button>
            <button onClick={() => setEditing(false)} className="btn btn-sm btn-outline" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>Cancel</button>
        </div>
    );
}

export default function TeamMemberCard({
    member,
    updating,
    isMe,
    currentUserRole,
    onToggleActive,
    onChangeRole,
    onUpdateHourlyRate,
    onDelete,
}: TeamMemberCardProps) {
    const isOwner = member.role === 'owner';
    const isDisabled = member.is_active === false;
    const canDelete = currentUserRole === 'owner';

    return (
        <div
            className="card"
            style={{
                padding: '1rem',
                opacity: isDisabled ? 0.6 : 1,
                backgroundColor: isDisabled ? 'var(--color-status-danger-bg)' : undefined,
            }}
        >
            <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: 'var(--font-weight-bold)', marginBottom: '0.25rem' }}>
                    {member.full_name || 'Unknown'}
                    {isMe && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>(You)</span>}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{member.email}</div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {isDisabled ? (
                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-4)', fontSize: '0.75rem', fontWeight: 'var(--font-weight-bold)', textTransform: 'var(--text-transform-heading)', backgroundColor: 'var(--color-status-danger-bg)', color: 'var(--color-status-danger-strong)' }}>Disabled</span>
                ) : (
                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-4)', fontSize: '0.75rem', fontWeight: 'var(--font-weight-bold)', textTransform: 'var(--text-transform-heading)', backgroundColor: 'var(--color-status-success-bg)', color: 'var(--color-status-success)' }}>Active</span>
                )}
                <span style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-4)',
                    fontSize: '0.75rem',
                    fontWeight: 'var(--font-weight-bold)',
                    textTransform: 'var(--text-transform-heading)',
                    backgroundColor: member.role === 'owner' ? 'var(--color-status-warning-bg-alt)' : member.role === 'manager' ? 'var(--color-accent-purple-bg-light)' : member.role === 'part_timer' ? 'var(--color-accent-blue-bg)' : 'var(--color-status-success-bg)',
                    color: member.role === 'owner' ? 'var(--color-status-warning-deep)' : member.role === 'manager' ? 'var(--color-accent-purple-strong)' : member.role === 'part_timer' ? 'var(--color-accent-blue)' : 'var(--color-status-success-strong)',
                }}>
                    {member.role === 'part_timer' ? 'Part-timer' : member.role}
                </span>
            </div>

            {member.role === 'part_timer' && (
                <HourlyRateField
                    currentRate={member.hourly_rate ?? null}
                    disabled={!!updating}
                    onSave={(rate) => onUpdateHourlyRate(member.id, rate)}
                />
            )}

            {!isMe && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: updating === member.id ? 0.5 : 1 }}>
                    {!isOwner && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => onChangeRole(member.id, 'staff')}
                                disabled={member.role === 'staff' || !!updating}
                                className={`btn btn-sm ${member.role === 'staff' ? 'btn-ghost' : 'btn-outline'}`}
                                style={{ flex: 1, fontSize: '0.8rem' }}
                            >
                                <Edit size={14} style={{ marginRight: '4px' }} />
                                Staff
                            </button>
                            <button
                                onClick={() => onChangeRole(member.id, 'manager')}
                                disabled={member.role === 'manager' || !!updating}
                                className={`btn btn-sm ${member.role === 'manager' ? 'btn-ghost' : 'btn-outline'}`}
                                style={{ flex: 1, fontSize: '0.8rem' }}
                            >
                                <Edit size={14} style={{ marginRight: '4px' }} />
                                Manager
                            </button>
                            <button
                                onClick={() => onChangeRole(member.id, 'part_timer')}
                                disabled={member.role === 'part_timer' || !!updating}
                                className={`btn btn-sm ${member.role === 'part_timer' ? 'btn-ghost' : 'btn-outline'}`}
                                style={{ flex: 1, fontSize: '0.8rem' }}
                            >
                                <Edit size={14} style={{ marginRight: '4px' }} />
                                Part-timer
                            </button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => onToggleActive(member.id, member.is_active)}
                            className={`btn btn-sm ${isDisabled ? 'btn-success' : 'btn-outline'}`}
                            style={{ flex: 1, fontSize: '0.8rem' }}
                            disabled={!!updating}
                        >
                            {isDisabled
                                ? <UserCheck size={14} style={{ marginRight: '4px' }} />
                                : <UserX size={14} style={{ marginRight: '4px' }} />
                            }
                            {isDisabled ? 'Enable' : 'Disable'}
                        </button>
                        {canDelete && (
                            <button
                                onClick={() => onDelete(member.id, member.full_name)}
                                className="btn btn-sm"
                                style={{ flex: 1, fontSize: '0.8rem', backgroundColor: 'var(--color-status-danger)', color: 'var(--color-white)' }}
                                disabled={!!updating}
                            >
                                <Trash2 size={14} style={{ marginRight: '4px' }} />
                                Delete
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
