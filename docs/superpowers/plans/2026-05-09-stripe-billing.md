# Stripe Billing Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe subscription billing to CafeOS so new cafes start a 14-day free trial on approval and are automatically suspended on non-payment.

**Architecture:** On super-admin approval, a Stripe Customer + Subscription (with trial) is created and IDs stored on the `cafes` row. Stripe webhooks drive all subsequent status changes (trial end, payment success/failure, cancellation) by updating `cafes.subscription_status` and `cafes.status`. Owners manage their card via the Stripe Customer Portal. Manual-approval flow is preserved — no card required at signup.

**Tech Stack:** `stripe` npm SDK (server-only), Stripe Billing (subscriptions + webhooks), Stripe Customer Portal, Next.js App Router API routes, Neon/Postgres.

---

## Pre-flight: Stripe Dashboard Setup (do this first, before any code)

- [ ] Log in to [dashboard.stripe.com](https://dashboard.stripe.com). If no account, create one.
- [ ] Create a **Product**: Name = "CafeOS", type = Service.
- [ ] Create a **Price** on that product: SGD 49.00/month recurring. Copy the `price_xxx` ID.
- [ ] Go to **Developers → Webhooks → Add endpoint**. URL = `https://<your-vercel-domain>/api/webhooks/stripe`. Select events:
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [ ] Copy the **Webhook Signing Secret** (`whsec_xxx`).
- [ ] Go to **Developers → API Keys**. Copy the **Secret Key** (`sk_live_xxx` or `sk_test_xxx` for testing).
- [ ] Add to Vercel environment variables (Production + Preview + Development):
  - `STRIPE_SECRET_KEY=sk_test_xxx`
  - `STRIPE_WEBHOOK_SECRET=whsec_xxx`
  - `STRIPE_PRICE_ID=price_xxx`
- [ ] Pull updated env locally: `vercel env pull .env.local`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `db/migrations/2026-05-09-billing.sql` | Create | Add billing columns to `cafes` |
| `src/lib/billing.ts` | Create | Stripe client + helper functions |
| `src/app/api/webhooks/stripe/route.ts` | Create | Stripe webhook handler |
| `src/app/api/start/route.ts` | Modify | Accept + save owner email |
| `src/app/start/page.tsx` | Modify | Add email field to signup form |
| `src/app/api/super/cafes/[id]/approve/route.ts` | Modify | Create Stripe customer + trial on approval |
| `src/app/api/billing/portal/route.ts` | Create | Create Stripe Customer Portal session |
| `src/app/c/[slug]/billing/page.tsx` | Create | Owner billing info + portal link |
| `src/app/super/cafes/[id]/page.tsx` | Modify | Show billing status in super admin |

---

## Task 1: DB Migration — Billing Columns

**Files:**
- Create: `db/migrations/2026-05-09-billing.sql`

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/2026-05-09-billing.sql
-- Adds Stripe billing columns to cafes.
-- Run on Neon after deploying the app changes.

BEGIN;

ALTER TABLE public.cafes
  ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS trial_ends_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status     TEXT;

COMMIT;
```

- [ ] **Step 2: Run it on Neon**

```bash
PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL_UNPOOLED" \
  -f db/migrations/2026-05-09-billing.sql
```

Expected output:
```
BEGIN
ALTER TABLE
COMMIT
```

- [ ] **Step 3: Verify columns exist**

```bash
PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT column_name FROM information_schema.columns
   WHERE table_name='cafes' AND column_name IN
   ('stripe_customer_id','stripe_subscription_id','trial_ends_at','subscription_status')
   ORDER BY column_name;"
```

Expected: 4 rows returned.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-05-09-billing.sql
git commit -m "feat: add billing columns to cafes table"
```

---

## Task 2: Stripe SDK + Billing Helper

**Files:**
- Create: `src/lib/billing.ts`

- [ ] **Step 1: Install Stripe SDK**

```bash
npm install stripe
```

- [ ] **Step 2: Create `src/lib/billing.ts`**

```typescript
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY is not set');

export const stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });

// Stripe subscription statuses that mean the cafe should be active.
const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ['trialing', 'active', 'past_due'];

// Stripe subscription statuses that mean the cafe should be suspended.
const SUSPENDED_STATUSES: Stripe.Subscription.Status[] = [
  'canceled',
  'unpaid',
  'paused',
  'incomplete_expired',
];

/** Returns the cafe status that should be set for a given Stripe subscription status. */
export function cafeStatusFromStripe(
  stripeStatus: Stripe.Subscription.Status,
): 'active' | 'suspended' | null {
  if (ACTIVE_STATUSES.includes(stripeStatus)) return 'active';
  if (SUSPENDED_STATUSES.includes(stripeStatus)) return 'suspended';
  return null; // 'incomplete' — do nothing, subscription not activated yet
}

export interface CreateSubscriptionResult {
  customerId: string;
  subscriptionId: string;
  trialEnd: Date;
}

/**
 * Creates a Stripe Customer and a trialing Subscription for a newly approved cafe.
 * No card is required upfront. At trial end, subscription pauses if no card is on file.
 */
export async function createStripeCustomerAndTrial(params: {
  cafeId: string;
  cafeName: string;
  ownerEmail: string | null;
  trialDays?: number;
}): Promise<CreateSubscriptionResult> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error('STRIPE_PRICE_ID is not set');

  const { cafeId, cafeName, ownerEmail, trialDays = 14 } = params;

  const customer = await stripe.customers.create({
    name: cafeName,
    ...(ownerEmail ? { email: ownerEmail } : {}),
    metadata: { cafe_id: cafeId },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    trial_period_days: trialDays,
    payment_settings: { save_default_payment_method: 'on_subscription' },
    trial_settings: { end_behavior: { missing_payment_method: 'pause' } },
  });

  const trialEnd = new Date((subscription.trial_end as number) * 1000);

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    trialEnd,
  };
}

/**
 * Creates a Stripe Customer Portal session URL.
 * The owner is redirected here to manage their card / cancel.
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/nyanyk/Antigravity/CafeOS && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/billing.ts
git commit -m "feat: add Stripe SDK and billing helper"
```

---

## Task 3: Stripe Webhook Route

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Create the webhook handler**

```typescript
// src/app/api/webhooks/stripe/route.ts
import { NextResponse } from 'next/server';
import { stripe, cafeStatusFromStripe } from '@/lib/billing';
import { sql } from '@/lib/db';
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
    event = stripe.webhooks.constructEvent(body, sig, secret);
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
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          await syncSubscription(sub);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Log only — let subscription status update handle the suspension.
        const invoice = event.data.object as Stripe.Invoice;
        console.warn('Invoice payment failed:', invoice.id, 'subscription:', invoice.subscription);
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
    // 'incomplete' — update subscription_status only, leave cafe status unchanged.
    await sql`
      UPDATE cafes
         SET subscription_status = ${sub.status},
             trial_ends_at       = ${trialEnd},
             updated_at          = NOW()
       WHERE stripe_subscription_id = ${sub.id}
    `;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Test webhook locally with Stripe CLI**

Install Stripe CLI if not present: `brew install stripe/stripe-cli/stripe`

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

In another terminal, trigger a test event:
```bash
stripe trigger customer.subscription.updated
```

Expected in the listener terminal: `200 OK` response.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: add Stripe webhook handler"
```

---

## Task 4: Collect Email at Signup + Wire Stripe on Approval

**Files:**
- Modify: `src/app/start/page.tsx`
- Modify: `src/app/api/start/route.ts`
- Modify: `src/app/api/super/cafes/[id]/approve/route.ts`

### Part A — Add email to signup form

- [ ] **Step 1: Add email field to `src/app/start/page.tsx`**

Find the form's existing phone input field and add an email field directly below it. Locate the block that renders the phone field (search for `ownerPhone` or `type="tel"`). Add after it:

```tsx
<div>
  <label htmlFor="ownerEmail" className="form-label">
    Email address
  </label>
  <input
    id="ownerEmail"
    name="ownerEmail"
    type="email"
    autoComplete="email"
    className="form-input"
    placeholder="you@example.com"
    value={form.ownerEmail ?? ''}
    onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))}
  />
  <p className="form-hint">Used for billing notifications. Optional.</p>
</div>
```

Also add `ownerEmail: string` to the form state type and initial state (`ownerEmail: ''`), and include it in the POST body:

```typescript
body: JSON.stringify({
  cafeName: form.cafeName,
  ownerName: form.ownerName,
  ownerPhone: form.ownerPhone,
  ownerEmail: form.ownerEmail || null,   // add this line
}),
```

- [ ] **Step 2: Update `src/app/api/start/route.ts` to accept and save email**

Add email parsing near the top of the `POST` handler (after existing `parseE164` call):

```typescript
// add this import at the top of the file:
import { parseEmail } from '@/lib/validators';  // we'll add this next

// in the POST body parsing block, after ownerPhone:
const ownerEmail = body.ownerEmail != null
  ? parseEmail(String(body.ownerEmail))
  : null;
```

In the new profile INSERT (the `else` branch that creates a new profile), add `email`:

```typescript
// Replace the existing INSERT for new profiles:
const { rows: created } = await sql<{ id: string }>`
  INSERT INTO profiles (phone_e164, full_name, email, pin_hash, is_active, is_super_admin)
  VALUES (${ownerPhone}, ${ownerName}, ${ownerEmail}, ${placeholderHash}, FALSE, FALSE)
  RETURNING id
`;
```

For existing profiles, update email if provided:

```typescript
// After: profileId = existingProfile[0].id;
if (ownerEmail) {
  await sql`UPDATE profiles SET email = ${ownerEmail} WHERE id = ${profileId}`;
}
```

- [ ] **Step 3: Add `parseEmail` to `src/lib/validators.ts`**

Open `src/lib/validators.ts` and add at the end:

```typescript
export function parseEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return '';
  // Basic RFC5322 shape — just check for @ with content on both sides.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ValidationError('Invalid email address');
  }
  if (trimmed.length > 254) throw new ValidationError('Email address is too long');
  return trimmed;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

### Part B — Create Stripe subscription on approval

- [ ] **Step 5: Modify `src/app/api/super/cafes/[id]/approve/route.ts`**

Replace the entire file with:

```typescript
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

    // Activate cafe + membership + profile atomically.
    await withTx(admin.id, async (tx) => {
      await tx.query(
        `UPDATE cafes SET status = 'active', approved_by = $1, approved_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [admin.id, cafeId],
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
    });

    // Create Stripe customer + trial subscription (outside transaction — Stripe is external).
    // If Stripe fails, cafe is already active; log the error and continue so the owner isn't blocked.
    if (!cafeRows[0].stripe_customer_id) {
      try {
        const billing = await createStripeCustomerAndTrial({
          cafeId,
          cafeName: cafeRows[0].name,
          ownerEmail,
        });

        await sql`
          UPDATE cafes
             SET stripe_customer_id    = ${billing.customerId},
                 stripe_subscription_id = ${billing.subscriptionId},
                 trial_ends_at          = ${billing.trialEnd.toISOString()},
                 subscription_status    = 'trialing',
                 updated_at             = NOW()
           WHERE id = ${cafeId}
        `;
      } catch (stripeErr) {
        console.error('Stripe subscription creation failed for cafe', cafeId, stripeErr);
        // Do not re-throw — cafe activation succeeded; billing can be set up manually.
      }
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
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit && npx eslint . --quiet
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/start/page.tsx src/app/api/start/route.ts \
        src/lib/validators.ts \
        src/app/api/super/cafes/[id]/approve/route.ts
git commit -m "feat: collect owner email at signup and create Stripe trial on approval"
```

---

## Task 5: Owner Billing Page + Portal API

**Files:**
- Create: `src/app/api/billing/portal/route.ts`
- Create: `src/app/c/[slug]/billing/page.tsx`

- [ ] **Step 1: Create `src/app/api/billing/portal/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { createBillingPortalSession } from '@/lib/billing';
import { sql } from '@/lib/db';
import { headers } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  try {
    const ctx = await requireTenantUser();

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

    const hdrs = await headers();
    const origin = hdrs.get('origin') ?? '';
    const returnUrl = `${origin}/c/${cafe.cafe_slug}/billing`;

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
```

- [ ] **Step 2: Create `src/app/c/[slug]/billing/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function BillingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to open billing portal');
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-container">
      <div className="card" style={{ maxWidth: 480, margin: '2rem auto' }}>
        <h1 className="page-title">Billing</h1>
        <p className="text-secondary" style={{ marginBottom: '1.5rem' }}>
          Manage your CafeOS subscription — update your payment method, view invoices, or cancel.
        </p>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {error}
          </div>
        )}
        <button className="btn btn-primary" onClick={openPortal} disabled={loading}>
          {loading ? 'Opening…' : 'Manage Billing'}
        </button>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: '0.75rem' }}
          onClick={() => router.back()}
        >
          Back
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add a billing link to the admin nav** 

In `src/app/c/[slug]/admin/page.tsx` (or the admin layout), add a link to the billing page visible to owners only. Find the section that conditionally renders owner-only links and add:

```tsx
{profile.role === 'owner' && (
  <a href={`/c/${cafeSlug}/billing`} className="nav-link">
    Billing
  </a>
)}
```

- [ ] **Step 4: Verify TypeScript + ESLint**

```bash
npx tsc --noEmit && npx eslint . --quiet
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/portal/route.ts src/app/c/[slug]/billing/page.tsx \
        src/app/c/[slug]/admin/page.tsx
git commit -m "feat: owner billing page and Stripe Customer Portal API"
```

---

## Task 6: Billing Status in Super Admin

**Files:**
- Modify: `src/app/super/cafes/[id]/page.tsx`

- [ ] **Step 1: Read the current super admin cafe detail page**

Open `src/app/super/cafes/[id]/page.tsx`. Find where the cafe data is fetched (the SQL query that selects from `cafes`). Add the new billing columns to the SELECT:

```typescript
// In the SQL query fetching cafe details, add these columns:
stripe_customer_id,
stripe_subscription_id,
trial_ends_at,
subscription_status,
```

And update the TypeScript type for the fetched row to include:

```typescript
stripe_customer_id: string | null;
stripe_subscription_id: string | null;
trial_ends_at: string | null;
subscription_status: string | null;
```

- [ ] **Step 2: Add billing section to the page JSX**

After the existing cafe status section, add:

```tsx
<section className="card" style={{ marginTop: '1.5rem' }}>
  <h2 className="section-title">Billing</h2>
  {cafe.stripe_customer_id ? (
    <dl className="detail-list">
      <div className="detail-row">
        <dt>Subscription status</dt>
        <dd>
          <span className={`badge badge-${billingBadgeVariant(cafe.subscription_status)}`}>
            {cafe.subscription_status ?? 'unknown'}
          </span>
        </dd>
      </div>
      {cafe.trial_ends_at && (
        <div className="detail-row">
          <dt>Trial ends</dt>
          <dd>{new Date(cafe.trial_ends_at).toLocaleDateString('en-SG', { dateStyle: 'medium' })}</dd>
        </div>
      )}
      <div className="detail-row">
        <dt>Stripe customer</dt>
        <dd>
          <a
            href={`https://dashboard.stripe.com/customers/${cafe.stripe_customer_id}`}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            {cafe.stripe_customer_id}
          </a>
        </dd>
      </div>
    </dl>
  ) : (
    <p className="text-secondary">No Stripe billing account linked to this cafe.</p>
  )}
</section>
```

Add the helper function above the component (or in a utils file):

```typescript
function billingBadgeVariant(status: string | null): string {
  switch (status) {
    case 'trialing':
    case 'active':
      return 'success';
    case 'past_due':
      return 'warning';
    case 'canceled':
    case 'unpaid':
    case 'paused':
    case 'incomplete_expired':
      return 'error';
    default:
      return 'neutral';
  }
}
```

- [ ] **Step 3: Verify TypeScript + ESLint**

```bash
npx tsc --noEmit && npx eslint . --quiet
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/super/cafes/[id]/page.tsx
git commit -m "feat: show billing status in super admin cafe detail"
```

---

## Task 7: End-to-End Test (manual)

- [ ] **Step 1: Test signup → approval → Stripe trial flow**

  1. Go to `/start`. Submit signup with an email. Confirm "pending" appears in DB:
     ```bash
     PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL_UNPOOLED" \
       -c "SELECT slug, status, stripe_customer_id FROM cafes ORDER BY created_at DESC LIMIT 3;"
     ```
  2. Log in as super admin → `/super/cafes` → approve the new cafe. Confirm PIN is returned.
  3. Check DB again — `stripe_customer_id`, `stripe_subscription_id`, `trial_ends_at`, `subscription_status = 'trialing'` should all be populated.
  4. Check Stripe dashboard → Customers → confirm the new customer exists with a trialing subscription.

- [ ] **Step 2: Test webhook → status sync**

  ```bash
  stripe trigger customer.subscription.updated \
    --override subscription:status=past_due
  ```

  Confirm in DB that `subscription_status` updated (use the subscription ID from step 1 to target correctly in a real test).

- [ ] **Step 3: Test owner billing portal**

  Log in as the new cafe owner → navigate to `/c/<slug>/billing` → click "Manage Billing" → should redirect to Stripe-hosted Customer Portal.

- [ ] **Step 4: Deploy to Vercel**

  ```bash
  git push origin main
  ```

  Then in Stripe dashboard, update the webhook endpoint URL to your production Vercel domain if it was pointing to localhost.

---

## Spec Coverage Check

| Requirement | Covered by |
|---|---|
| 14-day free trial on approval | Task 4 (approve route creates trialing subscription) |
| No card required at signup | Task 4 (trial; card collected later via portal) |
| Auto-suspend on non-payment | Task 3 (webhook: canceled/unpaid/paused → suspended) |
| Auto-reactivate on payment | Task 3 (webhook: invoice.payment_succeeded → active) |
| Owner can manage card | Task 5 (Stripe Customer Portal) |
| Super admin sees billing status | Task 6 |
| Email for billing notifications | Task 4 (email collected at signup, passed to Stripe) |
| DB migration | Task 1 |
