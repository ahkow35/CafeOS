'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createClient } from '@/lib/supabase';
import { Task } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import { CheckSquare, AlertTriangle, CalendarDays, Sunrise, CalendarRange, ChevronDown, ChevronUp, PartyPopper } from 'lucide-react';

export default function TasksPage() {
    const { user, profile, loading } = useAuth();
    const router = useRouter();
    const supabase = createClient();

    const [tasks, setTasks] = useState<Task[]>([]);
    const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
    const [tasksLoading, setTasksLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showCompleted, setShowCompleted] = useState(false);

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    useEffect(() => {
        if (user) {
            fetchTasks();
        }
    }, [user]);

    const fetchTasks = async () => {
        setFetchError(null);
        try {
            // Fetch pending tasks
            const { data: pendingData, error: pendingError } = await supabase
                .from('tasks')
                .select('*')
                .eq('status', 'pending')
                .order('deadline', { ascending: true });

            if (pendingError) throw pendingError;
            setTasks((pendingData as Task[]) ?? []);

            // Fetch completed tasks (last 7 days)
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);

            const { data: completedData, error: completedError } = await supabase
                .from('tasks')
                .select('*')
                .eq('status', 'done')
                .gte('completed_at', weekAgo.toISOString())
                .order('completed_at', { ascending: false })
                .limit(10);

            if (completedError) throw completedError;
            setCompletedTasks((completedData as Task[]) ?? []);
        } catch (err) {
            console.error('Failed to load tasks:', err);
            setFetchError('Failed to load tasks. Please try again.');
        } finally {
            setTasksLoading(false);
        }
    };

    const groupTasksByDate = (tasks: Task[]) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        const overdue: Task[] = [];
        const todayTasks: Task[] = [];
        const tomorrowTasks: Task[] = [];
        const upcoming: Task[] = [];

        tasks.forEach(task => {
            const deadline = new Date(task.deadline);
            deadline.setHours(0, 0, 0, 0);

            if (deadline < today) {
                overdue.push(task);
            } else if (deadline.getTime() === today.getTime()) {
                todayTasks.push(task);
            } else if (deadline.getTime() === tomorrow.getTime()) {
                tomorrowTasks.push(task);
            } else {
                upcoming.push(task);
            }
        });

        return { overdue, todayTasks, tomorrowTasks, upcoming };
    };

    if (loading || !user) {
        return (
            <div className="loading" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    const { overdue, todayTasks, tomorrowTasks, upcoming } = groupTasksByDate(tasks);

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">My Tasks</h1>
                        <p className="page-subtitle">{tasks.length} pending task{tasks.length !== 1 ? 's' : ''}</p>
                    </section>

                    {fetchError ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-title" style={{ color: '#ef4444' }}>Failed to load tasks</div>
                            <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                            <button className="btn btn-primary" onClick={fetchTasks}>Try again</button>
                        </div>
                    ) : tasksLoading ? (
                        <div className="loading">
                            <div className="spinner" />
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon">
                                <PartyPopper size={48} />
                            </div>
                            <div className="empty-state-title">All caught up!</div>
                            <p>You have no pending tasks</p>
                        </div>
                    ) : (
                        <>
                            {/* Overdue */}
                            {overdue.length > 0 && (
                                <section className="section animate-in">
                                    <h2 className="section-title text-danger">
                                        <AlertTriangle size={20} />
                                        <span>Overdue</span>
                                    </h2>
                                    {overdue.map(task => (
                                        <TaskCard key={task.id} task={task} onComplete={fetchTasks} />
                                    ))}
                                </section>
                            )}

                            {/* Today */}
                            {todayTasks.length > 0 && (
                                <section className="section animate-in">
                                    <h2 className="section-title">
                                        <CalendarDays size={20} />
                                        <span>Today</span>
                                    </h2>
                                    {todayTasks.map(task => (
                                        <TaskCard key={task.id} task={task} onComplete={fetchTasks} />
                                    ))}
                                </section>
                            )}

                            {/* Tomorrow */}
                            {tomorrowTasks.length > 0 && (
                                <section className="section animate-in">
                                    <h2 className="section-title">
                                        <Sunrise size={20} />
                                        <span>Tomorrow</span>
                                    </h2>
                                    {tomorrowTasks.map(task => (
                                        <TaskCard key={task.id} task={task} onComplete={fetchTasks} />
                                    ))}
                                </section>
                            )}

                            {/* Upcoming */}
                            {upcoming.length > 0 && (
                                <section className="section animate-in">
                                    <h2 className="section-title">
                                        <CalendarRange size={20} />
                                        <span>Upcoming</span>
                                    </h2>
                                    {upcoming.map(task => (
                                        <TaskCard key={task.id} task={task} onComplete={fetchTasks} />
                                    ))}
                                </section>
                            )}
                        </>
                    )}

                    {/* Completed Tasks Toggle */}
                    {completedTasks.length > 0 && (
                        <section className="section animate-in">
                            <button
                                className="btn btn-ghost btn-block"
                                onClick={() => setShowCompleted(!showCompleted)}
                            >
                                {showCompleted ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                <span>{showCompleted ? 'Hide' : 'Show'} Completed ({completedTasks.length})</span>
                            </button>

                            {showCompleted && (
                                <div className="mt-md">
                                    {completedTasks.map(task => (
                                        <TaskCard key={task.id} task={task} onComplete={fetchTasks} />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </main>
            <BottomNav />
        </>
    );
}
