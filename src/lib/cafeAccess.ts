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

/**
 * Telegram chat ids of the people in this cafe, in one of the given roles, whose own access is on
 * (facts 1 to 3). The cafe's status is not checked here: these are alerts to the cafe's own
 * people, and the billing alert has to reach the owners of a cafe that is not active.
 */
export async function listAccessChatIds(cafeId: string, roles: MembershipRole[]): Promise<string[]> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT p.telegram_chat_id
      FROM cafe_memberships m
      JOIN profiles p ON p.id = m.user_id
     WHERE m.cafe_id = ${cafeId}
       AND m.role = ANY(string_to_array(${roles.join(',')}, ','))
       AND m.status = 'active'
       AND m.employment_active = TRUE
       AND p.is_active = TRUE
       AND p.telegram_chat_id IS NOT NULL
  `;
  return rows.map((r) => r.telegram_chat_id);
}

/** One seat a person holds: the cafe's fields, the role and the employment data kept on the membership. */
export interface MembershipRow {
  cafe_id: string;
  cafe_slug: string;
  cafe_name: string;
  cafe_logo_url: string | null;
  role: MembershipRole;
  job_title: string | null;
  annual_leave_balance: number;
  medical_leave_balance: number;
  medical_claim_balance: string;
  hourly_rate: string | null;
}

/** Every cafe this person has access to (facts 1, 2 and 4; the caller has already checked the profile), by cafe name. */
export async function listActiveMemberships(userId: string): Promise<MembershipRow[]> {
  const { rows } = await sql<MembershipRow>`
    SELECT m.cafe_id, c.slug AS cafe_slug, c.name AS cafe_name,
           c.logo_url AS cafe_logo_url, m.role,
           m.job_title, m.annual_leave_balance, m.medical_leave_balance, m.medical_claim_balance, m.hourly_rate
      FROM cafe_memberships m
      JOIN cafes c ON c.id = m.cafe_id
     WHERE m.user_id = ${userId}
       AND m.status  = 'active'
       AND m.employment_active = TRUE
       AND c.status  = 'active'
     ORDER BY c.name
  `;
  return rows;
}

/** What the per-request check reads: the role, the cafe's status, and the profile's state, for an active membership. */
export interface RequestAccessRow {
  role: MembershipRole;
  cafe_status: string;
  employment_active: boolean;
  is_active: boolean;
  token_version: number;
}

/**
 * One query for the per-request check: the membership row for this person and cafe when its status is
 * 'active', with the cafe status, employment flag and the profile's is_active and token_version.
 * Returns undefined when there is no such row. The caller decides what each fact means, and in what order.
 */
export async function lookupRequestAccess(userId: string, cafeId: string): Promise<RequestAccessRow | undefined> {
  const { rows } = await sql<RequestAccessRow>`
    SELECT m.role, c.status AS cafe_status, m.employment_active,
           p.is_active, p.token_version
      FROM cafe_memberships m
      JOIN cafes c    ON c.id = m.cafe_id
      JOIN profiles p ON p.id = m.user_id
     WHERE m.user_id = ${userId}
       AND m.cafe_id = ${cafeId}
       AND m.status  = 'active'
     LIMIT 1
  `;
  return rows[0];
}
