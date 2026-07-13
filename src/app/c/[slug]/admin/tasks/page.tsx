'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Task, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import { Plus, History, ClipboardList, ArrowLeft, Check } from 'lucide-react';

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

export default function AdminTasksPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();

    const [staff, setStaff] = useState<User[]>([]);
    const [recentTasks, setRecentTasks] = useState<Task[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [deadline, setDeadline] = useState('');
    const [assignedTo, setAssignedTo] = useState('all');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const isManagerOrOwner = profile?.role === 'manager' || profile?.role === 'owner';

    const fetchData = useCallback(async () => {
        try {
            const [profilesRes, tasksRes] = await Promise.all([
                jsonOrError(await fetch('/api/profiles')) as Promise<{ users: User[] }>,
                jsonOrError(await fetch('/api/tasks?scope=recent-done')) as Promise<{ tasks: Task[] }>,
            ]);
            setStaff(profilesRes.users ?? []);
            setRecentTasks(tasksRes.tasks ?? []);
        } catch (err) {
            console.error('Failed to fetch admin tasks data:', err);
        } finally {
            setTasksLoading(false);
        }
    }, []);

    useEffect(() => {
        if (loading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isManagerOrOwner) { router.push(`/c/${slug}/leave`); return; }
        if (isManagerOrOwner) fetchData();
    }, [user, profile, loading, isManagerOrOwner, fetchData, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!title.trim()) {
            setError('Please enter a task title');
            return;
        }
        if (!deadline) {
            setError('Please select a deadline');
            return;
        }

        setSubmitting(true);
        try {
            await jsonOrError(await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    description: description.trim() || null,
                    deadline: new Date(deadline).toISOString(),
                    assigned_to: assignedTo,
                }),
            }));
            setSuccess('Task created successfully!');
            setTitle('');
            setDescription('');
            setDeadline('');
            setAssignedTo('all');
            fetchData();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to create task');
        } finally {
            setSubmitting(false);
        }
    };

    const getAssigneeName = (assignedToId: string) => {
        if (assignedToId === 'all') return 'Everyone';
        const member = staff.find(s => s.id === assignedToId);
        return member?.full_name || 'Unknown';
    };

    if (loading || !user || !profile || !isManagerOrOwner) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    // datetime-local expects LOCAL wall-clock time. Using toISOString() (UTC) here
    // shifts the min by the timezone offset (8h for SGT), so build it from local parts.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Task Management</h1>
                        <p className="page-subtitle">Create and track team tasks</p>
                    </section>

                    <section className="section animate-in">
                        <h2 className="section-title">
                            <Plus size={20} />
                            <span>Create New Task</span>
                        </h2>

                        <form onSubmit={handleSubmit} className="card">
                            <div className="form-group">
                                <label htmlFor="title" className="form-label">
                                    Task Title *
                                </label>
                                <input
                                    id="title"
                                    type="text"
                                    className="form-input"
                                    placeholder="e.g., Restock coffee beans"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="description" className="form-label">
                                    Description (optional)
                                </label>
                                <textarea
                                    id="description"
                                    className="form-input form-textarea"
                                    placeholder="Add details about the task..."
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="deadline" className="form-label">
                                    Deadline *
                                </label>
                                <input
                                    id="deadline"
                                    type="datetime-local"
                                    className="form-input"
                                    value={deadline}
                                    onChange={(e) => setDeadline(e.target.value)}
                                    min={today}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="assignedTo" className="form-label">
                                    Assign To
                                </label>
                                <select
                                    id="assignedTo"
                                    className="form-input form-select"
                                    value={assignedTo}
                                    onChange={(e) => setAssignedTo(e.target.value)}
                                >
                                    <option value="all">Everyone (Team Task)</option>
                                    {staff.map(member => (
                                        <option key={member.id} value={member.id}>
                                            {member.full_name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {error && <div className="form-error mb-md">{error}</div>}
                            {success && <div className="text-success mb-md">{success}</div>}

                            <button
                                type="submit"
                                className="btn btn-primary btn-block"
                                disabled={submitting}
                            >
                                {submitting ? (
                                    'Creating...'
                                ) : (
                                    <>
                                        <Check size={18} />
                                        <span>Create Task</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </section>

                    <section className="section animate-in">
                        <h2 className="section-title">
                            <History size={20} />
                            <span>Recently Completed</span>
                        </h2>

                        {tasksLoading ? (
                            <div className="loading">
                                <div className="spinner" />
                            </div>
                        ) : recentTasks.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon">
                                    <ClipboardList size={48} />
                                </div>
                                <div className="empty-state-title">No completed tasks yet</div>
                                <p>Completed tasks will appear here</p>
                            </div>
                        ) : (
                            recentTasks.map(task => (
                                <TaskCard
                                    key={task.id}
                                    task={task}
                                    showAssignee={true}
                                    assigneeName={getAssigneeName(task.assigned_to)}
                                />
                            ))
                        )}
                    </section>

                    <button
                        className="btn btn-ghost btn-block mt-lg"
                        onClick={() => router.push(`/c/${slug}/admin`)}
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
