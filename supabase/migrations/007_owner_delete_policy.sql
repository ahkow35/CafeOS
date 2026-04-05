-- Migration 007: Allow owners to delete leave records
-- Managers cannot delete — owner-only action for record cleanup.

CREATE POLICY "Owners can delete leave requests" ON public.leave_requests
    FOR DELETE USING (public.is_owner());
