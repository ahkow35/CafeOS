'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { createClient } from '@/lib/supabase';
import { Task } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import LeaveBalanceCard from '@/components/LeaveBalanceCard';
import PendingApprovalsWidget from '@/components/PendingApprovalsWidget';
import { Palmtree, ClipboardList, Settings, Plus, PartyPopper } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const supabase = createClient();
  const { user, profile, loading: authLoading, profileLoading } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    // Wait for auth and profile to resolve before acting
    if (authLoading || profileLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    loadDashboardData();
  }, [user, authLoading, profileLoading, router]);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      setDataLoading(true);
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

    } catch (error) {
      console.error('Dashboard load error', error);
    } finally {
      setDataLoading(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getFirstName = () => {
    return profile?.full_name?.split(' ')[0] || 'there';
  };

  // Combined loading state — show skeleton instead of blank spinner
  if (authLoading || profileLoading || dataLoading) {
    return (
      <>
        <Header />
        <main className="page">
          <div className="container">
            <section className="section">
              <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 16, width: '40%' }} />
            </section>
            <section className="section">
              <div className="skeleton" style={{ height: 20, width: '30%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 80, borderRadius: 8 }} />
            </section>
            <section className="section">
              <div className="skeleton" style={{ height: 20, width: '35%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 64, borderRadius: 8, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 64, borderRadius: 8 }} />
            </section>
          </div>
        </main>
        <BottomNav />
      </>
    );
  }

  // If profile is missing after loading, it means error or no user.
  // Guard includes authLoading/profileLoading so Safari doesn't flash this
  // during the brief window after login where profile is still resolving.
  if (!authLoading && !profileLoading && !profile) {
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
  // Narrow type for TypeScript — compound condition above handles the real guard
  if (!profile) return null;

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
              annualBalance={profile.annual_leave_balance}
              medicalBalance={profile.medical_leave_balance}
            />
          </section>

          {/* Today's Tasks */}
          <section className="section animate-in">
            <h2 className="section-title">
              <ClipboardList size={20} />
              <span>Today&apos;s Priorities</span>
            </h2>

            {tasks.length > 0 ? (
              <>
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={loadDashboardData}
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
          {(profile.role === 'manager' || profile.role === 'owner') && (
            <>
              <section className="section animate-in">
                <h2 className="section-title">
                  <Settings size={20} />
                  <span>Pending Approvals</span>
                </h2>
                <PendingApprovalsWidget
                  userRole={profile.role as 'manager' | 'owner'}
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
