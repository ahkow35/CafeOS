/**
 * The writes that store a new PIN hash on a profile. Each takes a SQL tag to run its statement with:
 * `sql` from '@/lib/db' for a single statement outside a transaction, or `onClient(client)` inside
 * one. Each does only the `profiles` UPDATE and returns the number of rows it changed. Any follow-up
 * statements stay with the route that makes them.
 */

interface WriteResult {
  rowCount: number | null;
}

export type PinWriteTag = (strings: TemplateStringsArray, ...values: string[]) => Promise<WriteResult>;

/** A tag that runs its statement on a transaction client, with `$1..$n` placeholders. */
export function onClient(client: { query(text: string, params: string[]): Promise<WriteResult> }): PinWriteTag {
  return (strings, ...values) => client.query(strings.reduce((text, part, i) => `${text}$${i}${part}`), values);
}

/** A new PIN for a person: clears the attempt count and lock, and signs out every earlier session. */
export async function storeNewPin(run: PinWriteTag, profileId: string, pinHash: string): Promise<number> {
  const result = await run`
    UPDATE profiles
       SET pin_hash = ${pinHash},
           failed_attempts = 0,
           locked_until = NULL,
           token_version = token_version + 1,
           updated_at = NOW()
     WHERE id = ${profileId}
  `;
  return result.rowCount ?? 0;
}

/** The first PIN issued to a cafe owner on approval: activates the profile and stamps pin_set_at. */
export async function storeIssuedOwnerPin(run: PinWriteTag, profileId: string, pinHash: string): Promise<number> {
  const result = await run`
    UPDATE profiles
       SET is_active     = TRUE,
           pin_hash      = ${pinHash},
           pin_set_at    = NOW(),
           token_version = token_version + 1,
           updated_at    = NOW()
     WHERE id = ${profileId}
  `;
  return result.rowCount ?? 0;
}
