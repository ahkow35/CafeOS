/**
 * The writes that store a new PIN hash on a profile. Each takes anything with a `query(text, params)`
 * method (a transaction client, or `{ query }` from '@/lib/db' for a single pooled statement), does only
 * the `profiles` UPDATE and returns the number of rows it changed. Any follow-up statements stay with
 * the route that makes them.
 */

export interface PinWriteExecutor {
  query(text: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

/** A new PIN for a person: clears the attempt count and lock, and signs out every earlier session. */
export async function storeNewPin(db: PinWriteExecutor, profileId: string, pinHash: string): Promise<number> {
  const result = await db.query(
    `UPDATE profiles
        SET pin_hash = $1,
            failed_attempts = 0,
            locked_until = NULL,
            token_version = token_version + 1,
            updated_at = NOW()
      WHERE id = $2`,
    [pinHash, profileId],
  );
  return result.rowCount ?? 0;
}

/** The first PIN issued to a cafe owner on approval: activates the profile and stamps pin_set_at. */
export async function storeIssuedOwnerPin(db: PinWriteExecutor, profileId: string, pinHash: string): Promise<number> {
  const result = await db.query(
    `UPDATE profiles
        SET is_active     = TRUE,
            pin_hash      = $1,
            pin_set_at    = NOW(),
            token_version = token_version + 1,
            updated_at    = NOW()
      WHERE id = $2`,
    [pinHash, profileId],
  );
  return result.rowCount ?? 0;
}
