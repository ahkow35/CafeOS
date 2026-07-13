import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import {
  getSessionClaims,
  signFullSession,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_COOKIE_MAX_AGE,
} from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * POST /api/auth/stop-impersonating
 *
 * Ends an impersonation session and restores the original super-admin session.
 * The impersonated JWT carries impersonator_id; we reconstruct the admin session
 * from it AFTER re-confirming that user is still a super admin in the database —
 * so a demoted admin cannot regain super access this way.
 *
 * Lives under /api/auth (not /api/super) so it is reachable while the active
 * session's is_super_admin claim is false. It performs its own authorization.
 *
 * Returns a 303 redirect to /super so it works as a plain form POST from the
 * impersonation banner without client-side JavaScript.
 */
export async function POST(req: Request): Promise<Response> {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.redirect(new URL('/login', req.url), 303);
  }
  if (!claims.impersonator_id) {
    // Not an impersonation session — nothing to restore.
    return NextResponse.json({ error: 'Not impersonating' }, { status: 400 });
  }

  const { rows } = await sql<{ id: string; is_super_admin: boolean; is_active: boolean }>`
    SELECT id, is_super_admin, is_active
      FROM profiles
     WHERE id = ${claims.impersonator_id}
     LIMIT 1
  `;
  const admin = rows[0];
  if (!admin || !admin.is_super_admin || !admin.is_active) {
    // The original admin is gone, demoted, or disabled — do not restore super access.
    const res = NextResponse.redirect(new URL('/login', req.url), 303);
    res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return res;
  }

  // Restore a super-admin session with no active cafe (lands at /super).
  const token = await signFullSession(admin.id, null, null, null, true);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_COOKIE_MAX_AGE });

  return NextResponse.redirect(new URL('/super', req.url), 303);
}
