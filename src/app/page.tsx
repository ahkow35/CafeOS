'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

import { Task } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import TaskCard from '@/components/TaskCard';
import LeaveBalanceCard from '@/components/LeaveBalanceCard';
import PendingApprovalsWidget from '@/components/PendingApprovalsWidget';
import { Palmtree, ClipboardList, Settings, Plus } from 'lucide-react';

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

export default function HomePage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, profileLoading } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);

  // Show retry prompt if loading takes more than 5s
  useEffect(() => {
    if (!authLoading && !profileLoading) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 5000);
    return () => clearTimeout(t);
  }, [authLoading, profileLoading]);

  const loadDashboardData = useCallback(async () => {
    try {
      setDataLoading(true);
      const data = await jsonOrError(await fetch('/api/tasks?scope=mine')) as { tasks: Task[] };
      const all = data.tasks ?? [];
      const cutoff = new Date();
      cutoff.setHours(23, 59, 59, 999);
      const cutoffMs = cutoff.getTime();
      const due = all
        .filter(t => t.status === 'pending' && new Date(t.deadline).getTime() <= cutoffMs)
        .slice(0, 5);
      setTasks(due);
    } catch (error) {
      console.error('Dashboard load error', error);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    loadDashboardData();
  }, [user, authLoading, profileLoading, router, loadDashboardData]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getFirstName = () => {
    return profile?.full_name?.split(' ')[0] || 'there';
  };

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
            {slowLoad && (
              <section className="section" style={{ textAlign: 'center', paddingTop: '0.5rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                  Taking longer than usual...
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="btn btn-outline"
                  style={{ fontSize: '0.875rem' }}
                >
                  Tap to retry
                </button>
              </section>
            )}
          </div>
        </main>
        <BottomNav />
      </>
    );
  }

  if (!authLoading && !profileLoading && !profile) {
    return (
      <div className="empty-state animate-in" style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="empty-state-title" style={{ color: '#ef4444' }}>Profile Not Found</div>
        <p>Your user account exists, but your profile data is missing.</p>
        <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
          Try signing out and signing back in. If the problem persists, contact an administrator.
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
  if (!profile) return null;

  return (
    <>
      <Header />
      <main className="page">
        <div className="container">
          <section className="section animate-in">
            <h1 className="page-title">{getGreeting()}, {getFirstName()}!</h1>
            <p className="page-subtitle">Welcome to your dashboard — {new Date().toLocaleDateString()}</p>
          </section>

          {profile.role !== 'part_timer' && (
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
          )}

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
                <div className="empty-state-title">No tasks due today</div>
              </div>
            )}
          </section>

          {(profile.role === 'manager' || profile.role === 'owner') && (
            <>
              <section className="section animate-in">
                <h2 className="section-title">
                  <Settings size={20} />
                  <span>Pending Approvals</span>
                </h2>
                <PendingApprovalsWidget userRole={profile.role as 'manager' | 'owner'} />
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
