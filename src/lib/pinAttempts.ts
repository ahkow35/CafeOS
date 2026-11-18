/**
 * Counts a sign-in attempt in one statement, shared by login and change-PIN.
 *
 * The attempt is counted first (one conditional UPDATE), then the PIN is compared.
 * Because the count and the lock check are the same statement, every attempt is
 * counted and no more than LOCKOUT_THRESHOLD are compared per lock window.
 * No transaction or row lock is held while the PIN is compared.
 */

import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

export type PinAttemptOutcome =
  /** The profile no longer exists. */
  | { kind: 'missing' }
  /** Locked when the attempt arrived; the PIN was not compared. */
  | { kind: 'locked'; lockedUntil: Date | null }
  /** Wrong PIN. `lockedNow` is true when this attempt reached the threshold. */
  | { kind: 'wrong'; lockedNow: boolean }
  /** Right PIN; the count is back to 0 and the lock is cleared. */
  | { kind: 'ok' };

/** Count one attempt against the profile, then compare the PIN. */
export async function attemptPin(profileId: string, pin: string, pinHash: string): Promise<PinAttemptOutcome> {
  const { rows: claimed } = await sql<{ failed_attempts: number }>`
    UPDATE profiles
       SET failed_attempts = failed_attempts + 1,
           locked_until = CASE
             WHEN failed_attempts + 1 >= ${LOCKOUT_THRESHOLD}
             THEN NOW() + (${LOCKOUT_MINUTES} || ' minutes')::interval
             ELSE locked_until
           END
     WHERE id = ${profileId}
       AND (locked_until IS NULL OR locked_until <= NOW())
    RETURNING failed_attempts
  `;

  if (claimed.length === 0) {
    const { rows } = await sql<{ locked_until: string | null }>`
      SELECT locked_until::text FROM profiles WHERE id = ${profileId} LIMIT 1
    `;
    if (!rows[0]) return { kind: 'missing' };
    return { kind: 'locked', lockedUntil: rows[0].locked_until ? new Date(rows[0].locked_until) : null };
  }

  if (!(await bcrypt.compare(pin, pinHash))) {
    return { kind: 'wrong', lockedNow: claimed[0].failed_attempts >= LOCKOUT_THRESHOLD };
  }

  await sql`UPDATE profiles SET failed_attempts = 0, locked_until = NULL WHERE id = ${profileId}`;
  return { kind: 'ok' };
}
