import { NextResponse } from 'next/server';
import { getStripe, cafeStatusFromStripe } from '@/lib/billing';
import { sql } from '@/lib/db';
import { notifyPaymentFailed } from '@/lib/notifications';
import type Stripe from 'stripe';

// Must use raw body for Stripe signature verification — do NOT parse as JSON.
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        // In Stripe API 2026-04-22.dahlia, invoice.subscription no longer exists.
        // The subscription reference lives at invoice.parent.subscription_details.subscription
        // and is typed as string | Stripe.Subscription.
        const subRef = invoice.parent?.subscription_details?.subscription;
        if (subRef) {
          const subId = typeof subRef === 'string' ? subRef : subRef.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          await syncSubscription(sub);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        const subId = subRef ? (typeof subRef === 'string' ? subRef : subRef.id) : null;
        console.warn('Invoice payment failed:', invoice.id, 'subscription:', subId);
        // Alert the cafe's owners so they can fix billing (best-effort).
        if (subId) {
          try {
            await notifyPaymentFailed(subId);
          } catch (err) {
            console.error('notifyPaymentFailed error:', err);
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error for event', event.type, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const cafeStatus = cafeStatusFromStripe(sub.status);

  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

  if (cafeStatus !== null) {
    await sql`
      UPDATE cafes
         SET subscription_status    = ${sub.status},
             trial_ends_at          = ${trialEnd},
             status                 = ${cafeStatus},
             updated_at             = NOW()
       WHERE stripe_subscription_id = ${sub.id}
    `;
  } else {
    await sql`
      UPDATE cafes
         SET subscription_status = ${sub.status},
             trial_ends_at       = ${trialEnd},
             updated_at          = NOW()
       WHERE stripe_subscription_id = ${sub.id}
    `;
  }
}
