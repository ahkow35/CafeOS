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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem', color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Hourly Rate:</span>
                <span style={{ fontWeight: 600 }}>{currentRate ? `S$${currentRate}/hr` : 'Not set'}</span>
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
            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>S$</span>
            <input
                type="number"
                value={value}
                onChange={e => setValue(e.target.value)}
                min="0"
                step="0.50"
                placeholder="e.g. 10"
                style={{ width: 80, border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.9rem' }}
                autoFocus
            />
            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>/hr</span>
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
                backgroundColor: isDisabled ? '#fee2e2' : undefined,
            }}
        >
            <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                    {member.full_name || 'Unknown'}
                    {isMe && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>(You)</span>}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{member.email}</div>
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
                    backgroundColor: member.role === 'owner' ? '#fef3c7' : member.role === 'manager' ? '#f3e8ff' : member.role === 'part_timer' ? '#e0f2fe' : '#dcfce7',
                    color: member.role === 'owner' ? '#b45309' : member.role === 'manager' ? '#7e22ce' : member.role === 'part_timer' ? '#0369a1' : '#15803d',
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
                                style={{ flex: 1, fontSize: '0.8rem', backgroundColor: '#ef4444', color: 'white' }}
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
