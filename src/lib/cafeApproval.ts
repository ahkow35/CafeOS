/**
 * Decides what POST /api/super/cafes/[id]/approve may do to the pending
 * cafe's owner profile. Pulled out as a pure function so the decision is
 * testable without a database — see tests/cafeApproval.test.ts.
 *
 * /api/start find-or-creates the owner profile by phone (ON CONFLICT keeps
 * the existing row), so the owner profile approval is about to activate may
 * already belong to someone else — a staff member at a different cafe who
 * happens to share this phone number. profiles.pin_set_at (set the first time
 * a real PIN is issued — see 2026-09-23-suspend-and-pin-provenance.sql) is
 * what tells the three cases apart:
 *
 * - issue_pin  — pin_set_at is NULL and the profile is inactive: this is a
 *   genuinely brand-new signup, still holding the /api/start placeholder PIN
 *   and never active anywhere. Generate a real PIN, same as today.
 * - keep_pin   — the profile already holds a real PIN and is currently
 *   active: this phone belongs to someone with a working account elsewhere.
 *   Activate the cafe/membership only; never touch their credential.
 * - refuse     — the profile already holds a real PIN but is currently
 *   inactive (deactivated, or an ambiguous pre-migration row with no
 *   activation history recorded). Reactivating or replacing that PIN here
 *   would be a silent guess about someone else's account, so the approval is
 *   refused and a super admin must resolve it manually.
 */
export type OwnerCredentialDecision =
  | { action: 'issue_pin' }
  | { action: 'keep_pin' }
  | { action: 'refuse'; reason: string };

export interface OwnerProfileState {
  isActive: boolean;
  pinSetAt: string | Date | null;
}

export function decideOwnerCredential(profile: OwnerProfileState): OwnerCredentialDecision {
  const hasRealPin = profile.pinSetAt !== null;

  if (!hasRealPin) {
    // Never overwrite an active account's PIN even if pin_set_at is somehow
    // unset (shouldn't happen post-migration, but active always wins).
    return profile.isActive ? { action: 'keep_pin' } : { action: 'issue_pin' };
  }

  if (profile.isActive) return { action: 'keep_pin' };

  return {
    action: 'refuse',
    reason:
      'This phone number already belongs to an existing account that is currently inactive. ' +
      'Resolve it manually before approving this cafe.',
  };
}
