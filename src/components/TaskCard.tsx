'use client';

import { Task } from '@/lib/database.types';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Clock, User } from 'lucide-react';

interface TaskCardProps {
    task: Task;
    onComplete?: () => void;
    showAssignee?: boolean;
    assigneeName?: string;
}

export default function TaskCard({ task, onComplete, showAssignee, assigneeName }: TaskCardProps) {
    const { user } = useAuth();
    const supabase = createClient();

    const formatDeadline = (deadline: string) => {
        const date = new Date(deadline);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const diffDays = Math.ceil((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return { text: 'Overdue', className: 'overdue' };
        if (diffDays === 0) return { text: 'Today', className: 'today' };
        if (diffDays === 1) return { text: 'Tomorrow', className: '' };

        return {
            text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            className: ''
        };
    };

    const handleToggle = async () => {
        const newStatus = task.status === 'done' ? 'pending' : 'done';

        const { error } = await supabase
            .from('tasks')
            .update({
                status: newStatus,
                completed_by: newStatus === 'done' ? user?.id : null,
                completed_at: newStatus === 'done' ? new Date().toISOString() : null,
            })
            .eq('id', task.id);

        if (!error && onComplete) {
            onComplete();
        }
    };

    const deadline = formatDeadline(task.deadline);
    const isDone = task.status === 'done';

    return (
        <div className={`task-card ${isDone ? 'done' : ''}`}>
            <label className="checkbox-wrapper" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                    type="checkbox"
                    className="checkbox"
                    checked={isDone}
                    onChange={handleToggle}
                />
            </label>

            <div className="task-content">
                <h3 className="task-title">{task.title}</h3>

                {task.description && (
                    <p className="task-description">{task.description}</p>
                )}

                <div className="task-meta">
                    <span className={`task-deadline ${deadline.className}`}>
                        <Clock size={14} />
                        <span>{deadline.text}</span>
                    </span>

                    {showAssignee && (
                        <span className="task-assignee">
                            <User size={14} />
                            <span>{task.assigned_to === 'all' ? 'Everyone' : assigneeName || 'Assigned'}</span>
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
