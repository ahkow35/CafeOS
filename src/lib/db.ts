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

/**
 * Patterns that mean "we could not talk to the database", as opposed to "the query
 * was wrong". Matched on the message because Neon's HTTP driver reports connection
 * and auth failures with an empty SQLSTATE `code` — the 2026-08-06 outage surfaced as
 * `NeonDbError: password authentication failed for user 'neondb_owner'` with
 * `code: ''`, so code-based detection alone would have missed it.
 */
const DB_UNAVAILABLE_PATTERNS = [
  /password authentication failed/i,
  /role .+ does not exist/i,
  /database .+ does not exist/i,
  /could not connect/i,
  /connection (refused|reset|closed|terminated|timeout)/i,
  /fetch failed/i,
  /too many connections/i,
  /missing_connection_string/i,
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/,
];

/**
 * True when an error means the database was unreachable — a deploy/infrastructure
 * problem the caller should surface as 503, not as a generic 500. A malformed query
 * or a missing column is a code bug and deliberately does NOT match.
 */
export function isDbUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Prefer SQLSTATE when the driver supplies one: class 08 = connection exception,
  // 28 = invalid authorization, 53300 = too many connections, 57P03 = cannot connect now.
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && code !== '') {
    return code.startsWith('08') || code.startsWith('28') || code === '53300' || code === '57P03';
  }

  return DB_UNAVAILABLE_PATTERNS.some((re) => re.test(`${err.name}: ${err.message}`));
}

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

/**
 * Plain transaction with no audit GUCs — for unauthenticated flows (e.g. /api/start
 * self-serve onboarding) where there is no actor/tenant context yet. Only use on
 * tables without audit triggers that require app.actor_id.
 */
export async function withPlainTx<T>(
  fn: (client: VercelPoolClient) => Promise<T>,
): Promise<T> {
  const client = await vercelDb.connect();
  try {
    await client.query('BEGIN');
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
