/**
 * Postgres client for Neon (Vercel Postgres).
 *
 *   sql`SELECT ... FROM profiles WHERE id = ${id}`        // pooled, fire-and-forget read
 *   await withTx(actorId, async (tx) => {                 // transactional write with audit context
 *     await tx`UPDATE leave_requests SET status = ${s} WHERE id = ${id}`;
 *   });
 *   await withTenantTx(ctx, async (tx) => {               // tenant-scoped write (preferred)
 *     await tx`UPDATE timesheets SET status = ${s} WHERE id = ${id} AND cafe_id = ${ctx.cafeId}`;
 *   });
 *
 * Both *Tx helpers run SET LOCAL (transaction-scoped) GUCs so audit triggers can tag
 * audit_log rows with actor_id, cafe_id, and impersonator_id automatically.
 * GUCs are set via set_config() to avoid manual string escaping.
 */

import { sql as vercelSql, db as vercelDb } from '@vercel/postgres';
import type { VercelPoolClient } from '@vercel/postgres';
import type { MembershipRole } from '@/lib/validators';

export const sql = vercelSql;

export interface TenantCtx {
  userId: string;
  cafeId: string;
  cafeSlug: string;
  role: MembershipRole;
  isSuperAdmin: boolean;
  impersonatorId?: string; // set when a super admin is "viewing as" another user
}

export async function withTx<T>(
  actorId: string,
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await vercelDb.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.actor_id', $1, TRUE)`, [actorId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function withTenantTx<T>(
  ctx: TenantCtx,
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await vercelDb.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.actor_id', $1, TRUE)`, [ctx.userId]);
    await client.query(`SELECT set_config('app.cafe_id', $1, TRUE)`, [ctx.cafeId]);
    if (ctx.impersonatorId) {
      await client.query(`SELECT set_config('app.impersonator_id', $1, TRUE)`, [ctx.impersonatorId]);
    }
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
