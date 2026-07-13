import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * GET /api/admin/stats
 * Returns the four counters shown on the admin dashboard.
 * Auth: manager or owner in the active cafe.
 */
export async function GET() {
  try {
    const ctx = await requireTenantUser();
    requireManagerInCafe(ctx);

    const { rows } = await sql<{
      pending_manager_leave: number;
      pending_owner_leave: number;
      pending_tasks: number;
      staff_count: number;
    }>`
      SELECT
        (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending_manager' AND cafe_id = ${ctx.cafeId})::int AS pending_manager_leave,
        (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending_owner'   AND cafe_id = ${ctx.cafeId})::int AS pending_owner_leave,
        (SELECT COUNT(*) FROM tasks         WHERE status = 'pending'          AND cafe_id = ${ctx.cafeId})::int AS pending_tasks,
        (SELECT COUNT(*)
           FROM cafe_memberships m
          WHERE m.cafe_id = ${ctx.cafeId}
            AND m.role    = 'staff'
            AND m.status  = 'active'
            AND m.employment_active = TRUE)::int AS staff_count
    `;
    const r = rows[0];
    return NextResponse.json({
      stats: {
        pendingManagerLeave: r.pending_manager_leave,
        pendingOwnerLeave: r.pending_owner_leave,
        pendingTasks: r.pending_tasks,
        staffCount: r.staff_count,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/stats GET error', e);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
