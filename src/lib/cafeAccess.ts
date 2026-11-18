/**
 * The one rule for "may this person act in this cafe".
 *
 * A person has access to a cafe when ALL FOUR hold:
 *   1. their cafe_memberships row for that cafe has status 'active';
 *   2. that row has employment_active = TRUE (the staff page's Disable switch);
 *   3. their profile has is_active = TRUE;
 *   4. the cafe itself has status 'active'.
 *
 * Imports only the database and types, so tests and scripts can load it freely
 * (no next/headers, no auth.ts).
 */
import { sql } from '@/lib/db';
import type { MembershipRole } from '@/lib/validators';

export type AccessVerdict =
  | 'ok'
  | 'no_membership'   // no membership row for this cafe, or its status is not 'active'
  | 'access_off'      // membership is active but employment_active is FALSE
  | 'profile_inactive'
  | 'cafe_not_active';

/** The four facts, null where the row does not exist. */
export interface AccessFacts {
  membershipStatus: string | null;
  employmentActive: boolean | null;
  profileActive: boolean | null;
  cafeStatus: string | null;
}

/** Pure: the four facts in, a verdict out. Checked in the order of the AccessVerdict list. */
export function accessVerdict(f: AccessFacts): AccessVerdict {
  if (f.membershipStatus !== 'active') return 'no_membership';
  if (f.employmentActive !== true) return 'access_off';
  if (f.profileActive !== true) return 'profile_inactive';
  if (f.cafeStatus !== 'active') return 'cafe_not_active';
  return 'ok';
}

export interface CafeAccess {
  verdict: AccessVerdict;
  profileActive: boolean;
  role: MembershipRole | null;
  cafeId: string | null;
  cafeSlug: string | null;
  cafeName: string | null;
  cafeLogoUrl: string | null;
}

interface AccessRow {
  membership_status: string | null;
  employment_active: boolean | null;
  profile_active: boolean;
  cafe_status: string | null;
  role: MembershipRole | null;
  cafe_id: string | null;
  cafe_slug: string | null;
  cafe_name: string | null;
  cafe_logo_url: string | null;
}

/**
 * Reads the four facts (plus the role and cafe fields callers need) for one person and one
 * cafe in one query. Returns null when no such profile exists. A cafe id that matches no
 * cafe, or a person with no membership there, comes back as 'no_membership'.
 */
export async function lookupCafeAccess(userId: string, cafeId: string): Promise<CafeAccess | null> {
  const { rows } = await sql<AccessRow>`
    SELECT m.status AS membership_status, m.employment_active, p.is_active AS profile_active,
           c.status AS cafe_status, m.role, c.id AS cafe_id, c.slug AS cafe_slug, c.name AS cafe_name,
           c.logo_url AS cafe_logo_url
      FROM profiles p
      LEFT JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = ${cafeId}
      LEFT JOIN cafes c ON c.id = ${cafeId}
     WHERE p.id = ${userId}
     LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    verdict: accessVerdict({
      membershipStatus: r.membership_status,
      employmentActive: r.employment_active,
      profileActive: r.profile_active,
      cafeStatus: r.cafe_status,
    }),
    profileActive: r.profile_active,
    role: r.role,
    cafeId: r.cafe_id,
    cafeSlug: r.cafe_slug,
    cafeName: r.cafe_name,
    cafeLogoUrl: r.cafe_logo_url,
  };
}

/** Telegram chat ids of the people who have access to this cafe in one of the given roles. */
export async function listAccessChatIds(cafeId: string, roles: MembershipRole[]): Promise<string[]> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT p.telegram_chat_id
      FROM cafe_memberships m
      JOIN profiles p ON p.id = m.user_id
      JOIN cafes c ON c.id = m.cafe_id
     WHERE m.cafe_id = ${cafeId}
       AND m.role = ANY(string_to_array(${roles.join(',')}, ','))
       AND m.status = 'active'
       AND m.employment_active = TRUE
       AND p.is_active = TRUE
       AND c.status = 'active'
       AND p.telegram_chat_id IS NOT NULL
  `;
  return rows.map((r) => r.telegram_chat_id);
}
