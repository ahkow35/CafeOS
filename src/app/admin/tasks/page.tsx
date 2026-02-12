'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Task, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import { CheckSquare, Plus, History, ClipboardList, ArrowLeft, Users, User as UserIcon, Check } from 'lucide-react';

export default function AdminTasksPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [staff, setStaff] = useState<User[]>([]);
    const [recentTasks, setRecentTasks] = useState<Task[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [deadline, setDeadline] = useState('');
    const [assignedTo, setAssignedTo] = useState('all');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const isManagerOrOwner = profile?.role === 'manager' || profile?.role === 'owner';

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        } else if (!loading && profile && !isManagerOrOwner) {
            router.push('/');
        }
    }, [user, profile, loading, router, isManagerOrOwner]);

    useEffect(() => {
        if (isManagerOrOwner) {
            fetchData();
        }
    }, [profile, isManagerOrOwner]);

    const fetchData = async () => {
        // Fetch staff for assignment dropdown
        const { data: staffData } = await supabase
            .from('profiles')
            .select('*')
            .order('full_name', { ascending: true });

        if (staffData) {
            setStaff(staffData as User[]);
        }

        // Fetch recent completed tasks
        const { data: tasksData } = await supabase
            .from('tasks')
            .select('*')
            .eq('status', 'done')
            .order('completed_at', { ascending: false })
            .limit(10);

        if (tasksData) {
            setRecentTasks(tasksData as Task[]);
        }

        setTasksLoading(false);
    };

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

        const { error: submitError } = await supabase
            .from('tasks')
            .insert({
                title: title.trim(),
                description: description.trim() || null,
                deadline: new Date(deadline).toISOString(),
                assigned_to: assignedTo,
                status: 'pending',
                created_by: user?.id,
            });

        if (submitError) {
            setError(submitError.message);
        } else {
            setSuccess('Task created successfully!');
            setTitle('');
            setDescription('');
            setDeadline('');
            setAssignedTo('all');
            fetchData();
        }

        setSubmitting(false);
    };

    const getAssigneeName = (assignedTo: string) => {
        if (assignedTo === 'all') return 'Everyone';
        const member = staff.find(s => s.id === assignedTo);
        return member?.full_name || 'Unknown';
    };

    if (loading || !user || !profile || !isManagerOrOwner) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const today = new Date().toISOString().slice(0, 16);

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Task Management</h1>
                        <p className="page-subtitle">Create and track team tasks</p>
                    </section>

                    {/* Create Task Form */}
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

                    {/* Recent Completed Tasks */}
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
