/**
 * Postgres client for Neon (Vercel Postgres).
 *
 *   sql`SELECT ... FROM profiles WHERE id = ${id}`        // pooled, fire-and-forget read
 *   await withTx(actorId, async (tx) => {                 // transactional write with audit context
 *     await tx`UPDATE leave_requests SET status = ${s} WHERE id = ${id}`;
 *   });
 *
 * `withTx` runs `SET LOCAL app.actor_id = $1` so the audit triggers in db/schema.sql can
 * tag the audit_log row. If you forget to wrap a status-change UPDATE in withTx, the trigger
 * silently skips the log row (instead of crashing on a NOT NULL violation).
 */

import { sql as vercelSql, db as vercelDb } from '@vercel/postgres';
import type { VercelPoolClient } from '@vercel/postgres';

export const sql = vercelSql;

export async function withTx<T>(
  actorId: string,
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await vercelDb.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL is scoped to the current transaction; no need to RESET on commit.
    await client.query(`SET LOCAL app.actor_id = '${actorId.replace(/'/g, "''")}'`);
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
