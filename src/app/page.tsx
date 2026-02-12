'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { createClient } from '@/lib/supabase';
import { Task, User } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import LeaveBalanceCard from '@/components/LeaveBalanceCard';
import PendingApprovalsWidget from '@/components/PendingApprovalsWidget';
import { Palmtree, ClipboardList, Settings, Plus, PartyPopper } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth(); // Use global auth state

  const [tasks, setTasks] = useState<Task[]>([]);
  const [localProfile, setLocalProfile] = useState<User | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    // Wait for global auth to finish
    if (authLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    loadDashboardData();
  }, [user, authLoading, router]);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      setDataLoading(true);
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      // Parallel Fetch
      const [profileResult, tasksResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('tasks')
          .select('*')
          .eq('status', 'pending')
          .lte('deadline', today.toISOString())
          .order('deadline', { ascending: true })
          .limit(5)
      ]);

      if (profileResult.error) {
        console.error('Profile load error', profileResult.error);
      } else {
        setLocalProfile(profileResult.data as User);
      }

      if (tasksResult.data) {
        setTasks(tasksResult.data as Task[]);
      }

    } catch (error) {
      console.error('Dashboard load error', error);
    } finally {
      setDataLoading(false);
    }
  };

  const fetchTodaysTasks = async () => {
    // Re-fetch only tasks
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'pending')
      .lte('deadline', today.toISOString())
      .order('deadline', { ascending: true })
      .limit(5);

    if (data) setTasks(data as Task[]);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getFirstName = () => {
    // Use full_name (the real column) AND add a ? before .split just in case it's empty
    return localProfile?.full_name?.split(' ')[0] || 'there';
  };

  // Check logic handled in loadDashboardData. 
  // If loading is false and we are here, we theoretically have a profile or are redirecting.

  // Combined loading state
  if (authLoading || dataLoading) {
    return (
      <div className="loading" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  // If localProfile is missing after loading, it means error or no user
  if (!localProfile) {
    return (
      <div className="empty-state animate-in" style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="empty-state-title" style={{ color: '#ef4444' }}>Profile Not Found</div>
        <p>Your user account exists, but your profile data is missing.</p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
          Please ask an administrator to run the <code>sync_profiles.sql</code> script.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-outline"
          style={{ marginTop: '1rem' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!localProfile) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Profile Not Found</div>
        <p>Please contact your administrator.</p>
      </div>
    );
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          {/* Welcome Section */}
          <section className="section animate-in">
            <h1 className="page-title">{getGreeting()}, {getFirstName()}!</h1>
            <p className="page-subtitle">Welcome to your dashboard — {new Date().toLocaleDateString()}</p>
          </section>

          {/* Leave Balance */}
          <section className="section animate-in">
            <h2 className="section-title">
              <Palmtree size={20} />
              <span>Leave Balance</span>
            </h2>
            <LeaveBalanceCard
              annualBalance={localProfile.annual_leave_balance}
              medicalBalance={localProfile.medical_leave_balance}
            />
          </section>

          {/* Today's Tasks */}
          <section className="section animate-in">
            <h2 className="section-title">
              <ClipboardList size={20} />
              <span>Today&apos;s Priorities</span>
            </h2>

            {/* Tasks List (already sorted) */}
            {/* We can use 'tasks' array directly */}

            {/* Tasks List (already sorted) */}

            {tasks.length > 0 ? (
              <>
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={fetchTodaysTasks}
                  />
                ))}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <PartyPopper size={48} />
                </div>
                <div className="empty-state-title">All caught up!</div>
                <p>No pending tasks for today</p>
              </div>
            )}
          </section>

          {/* Manager/Owner Quick Actions & Pending Approvals */}
          {(localProfile.role === 'manager' || localProfile.role === 'owner') && (
            <>
              <section className="section animate-in">
                <h2 className="section-title">
                  <Settings size={20} />
                  <span>Pending Approvals</span>
                </h2>
                <PendingApprovalsWidget
                  userRole={localProfile.role as 'manager' | 'owner'}
                  userId={user!.id}
                />
              </section>

              <section className="section animate-in">
                <h2 className="section-title">
                  <Settings size={20} />
                  <span>Admin Quick Actions</span>
                </h2>
                <div className="stats-grid">
                  <button
                    className="stat-card"
                    onClick={() => router.push('/admin/leave')}
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <div className="stat-icon">
                      <ClipboardList size={24} />
                    </div>
                    <div className="stat-label">Review Leave</div>
                  </button>
                  <button
                    className="stat-card"
                    onClick={() => router.push('/admin/tasks')}
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                  >
                    <div className="stat-icon">
                      <Plus size={24} />
                    </div>
                    <div className="stat-label">Create Task</div>
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
