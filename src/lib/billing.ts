import Stripe from 'stripe';

// Lazily constructed so importing this module (e.g. during `next build` page-data
// collection) does not require STRIPE_SECRET_KEY. The client is created on first
// use and cached for the lifetime of the server process.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  _stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
  return _stripe;
}

// `past_due` deliberately keeps the cafe ACTIVE (a grace period during Stripe's
// dunning retries) rather than cutting access on the first failed charge. Owners
// are alerted on invoice.payment_failed (see notifyPaymentFailed); if payment is
// never recovered Stripe moves the sub to unpaid/canceled, which suspends below.
const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ['trialing', 'active', 'past_due'];

const SUSPENDED_STATUSES: Stripe.Subscription.Status[] = [
  'canceled',
  'unpaid',
  'paused',
  'incomplete_expired',
];

export function cafeStatusFromStripe(
  stripeStatus: Stripe.Subscription.Status,
): 'active' | 'suspended' | null {
  if (ACTIVE_STATUSES.includes(stripeStatus)) return 'active';
  if (SUSPENDED_STATUSES.includes(stripeStatus)) return 'suspended';
  return null;
}

export interface CreateSubscriptionResult {
  customerId: string;
  subscriptionId: string;
  trialEnd: Date;
}

export async function createStripeCustomerAndTrial(params: {
  cafeId: string;
  cafeName: string;
  ownerEmail: string | null;
  trialDays?: number;
}): Promise<CreateSubscriptionResult> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error('STRIPE_PRICE_ID is not set');

  const { cafeId, cafeName, ownerEmail, trialDays = 14 } = params;
  const stripe = getStripe();

  // Idempotency keys keyed on cafeId: concurrent approvals or a retry after a
  // partial failure return the SAME customer/subscription instead of duplicating.
  const customer = await stripe.customers.create(
    {
      name: cafeName,
      ...(ownerEmail ? { email: ownerEmail } : {}),
      metadata: { cafe_id: cafeId },
    },
    { idempotencyKey: `cafe-customer-${cafeId}` },
  );

  const subscription = await stripe.subscriptions.create(
    {
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_settings: { save_default_payment_method: 'on_subscription' },
      trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
    },
    { idempotencyKey: `cafe-sub-${cafeId}` },
  );

  const trialEnd = new Date((subscription.trial_end as number) * 1000);

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    trialEnd,
  };
}

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}
