import { NextResponse } from 'next/server';
import { requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import { createBillingPortalSession } from '@/lib/billing';
import { sql } from '@/lib/db';
import { appBaseUrl } from '@/lib/appUrl';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx); // billing is owner-only — staff/managers must not reach Stripe

    const { rows } = await sql<{
      stripe_customer_id: string | null;
      cafe_slug: string;
    }>`
      SELECT c.stripe_customer_id, c.slug AS cafe_slug
        FROM cafes c
       WHERE c.id = ${ctx.cafeId}
       LIMIT 1
    `;

    const cafe = rows[0];
    if (!cafe?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No billing account found. Contact support.' },
        { status: 404 },
      );
    }

    // Derive the return URL from our own configured base URL, never the incoming
    // Origin header (attacker-controlled — could redirect the portal off-site).
    const returnUrl = `${appBaseUrl()}/c/${cafe.cafe_slug}/billing`;

    const portalUrl = await createBillingPortalSession(cafe.stripe_customer_id, returnUrl);

    return NextResponse.json({ url: portalUrl });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('billing/portal POST error', e);
    return NextResponse.json({ error: 'Failed to create billing session' }, { status: 500 });
  }
}
