-- Phase 6.4: per-user completion for "everyone" tasks.
--
-- Before: a task assigned to 'all' was one row with one status — the first person
-- to complete it marked it done for the whole team. Now each person completes
-- their own copy via this table. Individual tasks (assigned to a specific UUID)
-- keep the existing single-row tasks.status model (one assignee, one completion).
--
-- Additive + idempotent.
-- Apply:  psql "$POSTGRES_URL_NON_POOLING" -f db/migrations/2026-07-14-task-completions.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.task_completions (
    task_id      UUID NOT NULL REFERENCES public.tasks(id)    ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_completions_user ON public.task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_task ON public.task_completions(task_id);

-- Preserve history: any existing 'all' task already marked done gets its single
-- completer recorded so it doesn't reset to pending for that person.
INSERT INTO public.task_completions (task_id, user_id, completed_at)
SELECT id, completed_by, COALESCE(completed_at, NOW())
  FROM public.tasks
 WHERE assigned_to = 'all' AND status = 'done' AND completed_by IS NOT NULL
ON CONFLICT (task_id, user_id) DO NOTHING;

COMMIT;
