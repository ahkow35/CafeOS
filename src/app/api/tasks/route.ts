import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth';
import { ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  assigned_to: string;
  status: 'pending' | 'done';
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * GET /api/tasks?scope=mine|all|recent-done&status=&since=
 *  - mine        : pending+done assigned to me OR to 'all' (default for staff/part_timer)
 *  - all         : manager/owner full list, optional ?status=&since=
 *  - recent-done : convenience — done in the last 7 days, limit 10 (everyone)
 */
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') ?? 'mine';

    if (scope === 'mine') {
      const { rows } = await sql<TaskRow>`
        SELECT id, title, description, deadline, assigned_to, status,
               created_by, completed_by, completed_at, created_at
          FROM tasks
         WHERE assigned_to = ${me.id} OR assigned_to = 'all'
         ORDER BY status ASC, deadline ASC
      `;
      return NextResponse.json({ tasks: rows });
    }

    if (scope === 'all') {
      if (me.role !== 'manager' && me.role !== 'owner') {
        throw new AuthError('forbidden', 'Manager or owner access required');
      }
      const status = url.searchParams.get('status');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 0, 1), 200) : 100;
      const { rows } = await sql<TaskRow>`
        SELECT id, title, description, deadline, assigned_to, status,
               created_by, completed_by, completed_at, created_at
          FROM tasks
         WHERE (${status}::text IS NULL OR status = ${status}::text)
         ORDER BY
           CASE WHEN status = 'done' THEN completed_at ELSE deadline END DESC
         LIMIT ${limit}
      `;
      return NextResponse.json({ tasks: rows });
    }

    if (scope === 'recent-done') {
      const { rows } = await sql<TaskRow>`
        SELECT id, title, description, deadline, assigned_to, status,
               created_by, completed_by, completed_at, created_at
          FROM tasks
         WHERE status = 'done'
           AND completed_at >= NOW() - INTERVAL '7 days'
         ORDER BY completed_at DESC
         LIMIT 10
      `;
      return NextResponse.json({ tasks: rows });
    }

    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('tasks GET error', e);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
}

/**
 * POST /api/tasks
 * Body: { title, description?, deadline (ISO), assigned_to ('all' | uuid) }
 * Auth: manager or owner.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    if (me.role !== 'manager' && me.role !== 'owner') {
      throw new AuthError('forbidden', 'Manager or owner access required');
    }
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw new ValidationError('title is required');
    if (title.length > 200) throw new ValidationError('title is too long (max 200 chars)');

    const description = typeof body.description === 'string' && body.description.trim().length > 0
      ? body.description.trim()
      : null;

    if (typeof body.deadline !== 'string' || body.deadline.length === 0) {
      throw new ValidationError('deadline is required');
    }
    const deadlineMs = Date.parse(body.deadline);
    if (Number.isNaN(deadlineMs)) throw new ValidationError('deadline must be a valid ISO date-time');
    const deadline = new Date(deadlineMs).toISOString();

    const assignedTo = typeof body.assigned_to === 'string' ? body.assigned_to.trim() : '';
    if (!assignedTo) throw new ValidationError('assigned_to is required ("all" or a user id)');
    if (assignedTo !== 'all' && !UUID_RE.test(assignedTo)) {
      throw new ValidationError('assigned_to must be "all" or a UUID');
    }

    if (assignedTo !== 'all') {
      const { rows: target } = await sql<{ id: string; is_active: boolean }>`
        SELECT id, is_active FROM profiles WHERE id = ${assignedTo} LIMIT 1
      `;
      if (target.length === 0) throw new ValidationError('Assignee does not exist');
      if (!target[0].is_active) throw new ValidationError('Assignee is inactive');
    }

    const { rows } = await sql<TaskRow>`
      INSERT INTO tasks (title, description, deadline, assigned_to, status, created_by)
      VALUES (${title}, ${description}, ${deadline}::timestamptz, ${assignedTo}, 'pending', ${me.id})
      RETURNING id, title, description, deadline, assigned_to, status,
                created_by, completed_by, completed_at, created_at
    `;
    return NextResponse.json({ task: rows[0] }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('tasks POST error', e);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
