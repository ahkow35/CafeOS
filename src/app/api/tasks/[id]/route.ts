import { NextResponse } from 'next/server';
import { sql, withTenantTx } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';
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

async function loadTask(id: string, cafeId: string): Promise<TaskRow | null> {
  const { rows } = await sql<TaskRow>`
    SELECT id, title, description, deadline, assigned_to, status,
           created_by, completed_by, completed_at, created_at
      FROM tasks
     WHERE id = ${id}
       AND cafe_id = ${cafeId}
     LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * PATCH /api/tasks/[id]
 * Body fields (whitelisted, all optional):
 *  - status        : 'pending' | 'done'         — assignee or admin (anyone can complete a 'all' task)
 *  - title         : string                     — admin only
 *  - description   : string | null              — admin only
 *  - deadline      : ISO date-time              — admin only
 *  - assigned_to   : 'all' | uuid               — admin only
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const task = await loadTask(id, ctx.cafeId);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const isAdmin = ctx.role === 'manager' || ctx.role === 'owner';
    const isAssignee = task.assigned_to === ctx.userId || task.assigned_to === 'all';

    type Update = Partial<{
      status: 'pending' | 'done';
      title: string;
      description: string | null;
      deadline: string;
      assigned_to: string;
      completed_by: string | null;
      completed_at: string | null;
    }>;
    const update: Update = {};

    if ('status' in body) {
      if (body.status !== 'pending' && body.status !== 'done') {
        throw new ValidationError('status must be "pending" or "done"');
      }
      if (!isAdmin && !isAssignee) {
        throw new AuthError('forbidden', 'Cannot change this task');
      }
      update.status = body.status;
      if (body.status === 'done') {
        update.completed_by = ctx.userId;
        update.completed_at = new Date().toISOString();
      } else {
        update.completed_by = null;
        update.completed_at = null;
      }
    }

    const adminFields = ['title', 'description', 'deadline', 'assigned_to'];
    const adminFieldUsed = adminFields.some(f => f in body);
    if (adminFieldUsed && !isAdmin) {
      throw new AuthError('forbidden', 'Manager or owner access required');
    }

    if ('title' in body) {
      const t = typeof body.title === 'string' ? body.title.trim() : '';
      if (!t) throw new ValidationError('title cannot be empty');
      if (t.length > 200) throw new ValidationError('title is too long (max 200 chars)');
      update.title = t;
    }

    if ('description' in body) {
      update.description = body.description == null
        ? null
        : (typeof body.description === 'string' && body.description.trim().length > 0
            ? body.description.trim() : null);
    }

    if ('deadline' in body) {
      if (typeof body.deadline !== 'string' || body.deadline.length === 0) {
        throw new ValidationError('deadline must be a valid ISO date-time');
      }
      const ms = Date.parse(body.deadline);
      if (Number.isNaN(ms)) throw new ValidationError('deadline must be a valid ISO date-time');
      update.deadline = new Date(ms).toISOString();
    }

    if ('assigned_to' in body) {
      const a = typeof body.assigned_to === 'string' ? body.assigned_to.trim() : '';
      if (!a) throw new ValidationError('assigned_to is required ("all" or a user id)');
      if (a !== 'all' && !UUID_RE.test(a)) throw new ValidationError('assigned_to must be "all" or a UUID');
      if (a !== 'all') {
        const { rows: target } = await sql<{ id: string; is_active: boolean }>`
          SELECT id, is_active FROM profiles WHERE id = ${a} LIMIT 1
        `;
        if (target.length === 0) throw new ValidationError('Assignee does not exist');
        if (!target[0].is_active) throw new ValidationError('Assignee is inactive');
      }
      update.assigned_to = a;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    const updated = await withTenantTx(ctx, async (tx) => {
      const r = await tx.query<TaskRow>(
        `UPDATE tasks SET
           status       = COALESCE($1, status),
           title        = COALESCE($2, title),
           description  = CASE WHEN $3::boolean THEN $4 ELSE description END,
           deadline     = COALESCE($5::timestamptz, deadline),
           assigned_to  = COALESCE($6, assigned_to),
           completed_by = CASE WHEN $7::boolean THEN $8::uuid ELSE completed_by END,
           completed_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE completed_at END
         WHERE id = $11
         RETURNING id, title, description, deadline, assigned_to, status,
                   created_by, completed_by, completed_at, created_at`,
        [
          update.status ?? null,
          update.title ?? null,
          'description' in update,
          update.description ?? null,
          update.deadline ?? null,
          update.assigned_to ?? null,
          'completed_by' in update,
          update.completed_by ?? null,
          'completed_at' in update,
          update.completed_at ?? null,
          id,
        ],
      );
      return r.rows[0];
    });

    return NextResponse.json({ task: updated });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('tasks PATCH error', e);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks/[id]
 * Auth: manager or owner.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireManagerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rowCount } = await sql`DELETE FROM tasks WHERE id = ${id} AND cafe_id = ${ctx.cafeId}`;
    if (rowCount === 0) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('tasks DELETE error', e);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
