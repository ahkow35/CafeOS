import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireSuperAdmin, hashPin, AuthError } from '@/lib/auth';
import { createStripeCustomerAndTrial } from '@/lib/billing';
import crypto from 'crypto';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireSuperAdmin();
    const { id: cafeId } = await params;
    if (!UUID_RE.test(cafeId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows: cafeRows } = await sql<{
      status: string;
      name: string;
      stripe_customer_id: string | null;
    }>`
      SELECT status, name, stripe_customer_id FROM cafes WHERE id = ${cafeId} LIMIT 1
    `;
    if (cafeRows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
    if (cafeRows[0].status !== 'pending') {
      return NextResponse.json({ error: 'Only pending cafes can be approved' }, { status: 409 });
    }

    // Fetch the owner's email for Stripe (may be null).
    const { rows: ownerRows } = await sql<{ email: string | null; user_id: string }>`
      SELECT p.email, m.user_id
        FROM cafe_memberships m
        JOIN profiles p ON p.id = m.user_id
       WHERE m.cafe_id = ${cafeId} AND m.role = 'owner'
       LIMIT 1
    `;
    const ownerEmail = ownerRows[0]?.email ?? null;

    // Generate owner PIN.
    const pin = crypto.randomInt(100000, 999999).toString().padStart(6, '0');
    const pinHash = await hashPin(pin);

    // Provision Stripe BEFORE activating the cafe, so a Stripe failure leaves the
    // cafe pending (retryable) rather than active-with-no-subscription. Skipped
    // entirely when billing isn't configured (keeps approval working without Stripe).
    // Idempotency keys inside createStripeCustomerAndTrial dedupe concurrent/retried
    // calls, so this never creates duplicate customers.
    const billingEnabled = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
    let billing: { customerId: string; subscriptionId: string; trialEnd: Date } | null = null;
    if (billingEnabled && !cafeRows[0].stripe_customer_id) {
      billing = await createStripeCustomerAndTrial({
        cafeId,
        cafeName: cafeRows[0].name,
        ownerEmail,
      });
    }

    // Activate cafe + membership + profile atomically, re-checking pending under a
    // row lock so a concurrent approval can't double-activate.
    const activated = await withTx(admin.id, async (tx) => {
      const { rows: locked } = await tx.query<{ status: string }>(
        `SELECT status FROM cafes WHERE id = $1 FOR UPDATE`,
        [cafeId],
      );
      if (locked[0]?.status !== 'pending') return false; // already approved by a concurrent request

      await tx.query(
        `UPDATE cafes
            SET status = 'active', approved_by = $1, approved_at = NOW(),
                stripe_customer_id     = COALESCE($3, stripe_customer_id),
                stripe_subscription_id = COALESCE($4, stripe_subscription_id),
                trial_ends_at          = COALESCE($5, trial_ends_at),
                subscription_status    = COALESCE($6, subscription_status),
                updated_at = NOW()
          WHERE id = $2`,
        [
          admin.id, cafeId,
          billing?.customerId ?? null,
          billing?.subscriptionId ?? null,
          billing?.trialEnd.toISOString() ?? null,
          billing ? 'trialing' : null,
        ],
      );

      const { rows: owners } = await tx.query<{ user_id: string }>(
        `UPDATE cafe_memberships SET status = 'active'
          WHERE cafe_id = $1 AND role = 'owner'
          RETURNING user_id`,
        [cafeId],
      );
      for (const { user_id } of owners) {
        await tx.query(
          `UPDATE profiles SET is_active = TRUE, pin_hash = $1, updated_at = NOW() WHERE id = $2`,
          [pinHash, user_id],
        );
      }
      return true;
    });

    if (!activated) {
      return NextResponse.json({ error: 'Cafe was already approved' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, pin });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id]/approve POST error', e);
    return NextResponse.json({ error: 'Failed to approve cafe' }, { status: 500 });
  }
}
