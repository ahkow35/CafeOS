# Medical Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Employees submit medical receipts with an amount against a per-employee yearly cap; the café owner approves (possibly at a lower amount) or rejects; approval deducts the cap.

**Architecture:** Mirrors the leave-request subsystem: a `medical_claims` table plus a `medical_claim_balance` column on `cafe_memberships`, tenant-scoped API routes under `/api/claims` using `withTenantTx` + `FOR UPDATE` for every balance write, Vercel Blob for receipts behind a gated read route, Telegram notifications via `after()`, and three pages under `/c/[slug]`. Delivered as two PRs: PR 1 generalises the blob helpers (no behaviour change) and adds the migration file; PR 2 is the feature.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript, `@vercel/postgres` on Neon, `@vercel/blob`, `lucide-react`, Node 24 test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-03-medical-claims-design.md`

## Global Constraints

- Merging to `main` deploys to production. Never push to `main`; every change lands via a feature-branch PR. Never merge a PR yourself.
- The production migration (`db/migrations/2026-09-03-medical-claims.sql`) is applied by Nyan **after PR 1 merges and before PR 2 merges**. Ask before touching the production database; never run migrations against it from this plan.
- `.env.local` in this repo points at the **production** Neon database and the production Telegram bot. Any local run (`next dev`, scripts) MUST use a separate env file (`.env.test.local`, see Task 10) with `TELEGRAM_BOT_TOKEN` unset so no real person is messaged.
- Money: SGD, `NUMERIC(10,2)`, > 0, at most 2 decimals, claim ≤ 9,999.99, cap ≤ 99,999.99. All arithmetic in SQL. `@vercel/postgres` returns NUMERIC as **strings**; convert at the API boundary only.
- Receipt: exactly one file per claim, `image/jpeg | image/png | image/heic | application/pdf`, ≤ 5 MB, stored under blob prefix `claim-receipts/{cafe_id}/{user_id}/`.
- Roles: `staff | manager | owner | part_timer`. Only `owner` decides claims. `manager` and `owner` may read the queue. Owner's own claim auto-approves.
- Follow existing error mapping in every route: `ValidationError` → 400, `RequestConflictError` → 409, `AuthError` (`unauthorized`) → 401, other `AuthError` → 403, everything else → 500 with `console.error`.
- Every route file: `export const runtime = 'nodejs';`.
- Commit messages: Conventional Commits, ending with the two attribution trailers used in this repo (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the `Claude-Session:` line from the session).
- No temporary or backup files left in the repo. Scratch scripts live in the session scratchpad, not the repo, except the `tests/` directory added in Task 1.

---

## File Structure

### PR 1 — `refactor/attachment-storage` (branched from `main`)

| File | Responsibility |
|---|---|
| `src/lib/storage.ts` (modify) | All Vercel Blob I/O keyed by `AttachmentKind`: validate own URL, upload, delete, stream a gated download. |
| `src/lib/uploads.ts` (create) | The shared upload route handler: auth + size/mime gate + `uploadAttachment`. |
| `src/app/api/uploads/medical-cert/route.ts` (modify) | One-liner delegating to `handleAttachmentUpload('medical-cert', req)`. |
| `src/app/api/leave-requests/[id]/attachment/route.ts` (modify) | Auth + lookup, then `streamGatedAttachment`. |
| `src/app/api/leave-requests/route.ts`, `[id]/route.ts` (modify) | Call the renamed helpers. |
| `tests/storage.test.ts` (create) | Unit tests for URL validation and content-type mapping. |
| `package.json` (modify) | `"test": "tsx --test tests/*.test.ts"`. |
| `db/migrations/2026-09-03-medical-claims.sql` (create) | Additive migration. |
| `db/schema.sql` (modify) | Same DDL added in place. |

### PR 2 — `feat/medical-claims` (rebased onto `main` after PR 1 merges)

| File | Responsibility |
|---|---|
| `src/lib/validators.ts` (modify) | `parseMoney`. |
| `src/lib/money.ts` (create) | `toMoney` (string→number) and `formatSGD`. |
| `src/lib/dateUtils.ts` (modify) | `todayInSingapore()`. |
| `src/lib/claims.ts` (create) | Row types, column list, `serialiseClaim` (money conversion + gated receipt URL). |
| `src/lib/database.types.ts` (modify) | `medical_claim_balance` on `User`; `MedicalClaim`, `ClaimStatus`. |
| `src/lib/auth.ts`, `src/context/AuthContext.tsx` (modify) | Surface `medical_claim_balance` on the session user. |
| `src/app/api/admin/users/route.ts`, `[id]/route.ts` (modify) | Read/write the cap. |
| `src/app/api/admin/stats/route.ts` (modify) | `pendingClaims` counter. |
| `src/lib/notifications.ts` (modify) | `notifyClaimSubmitted`, `notifyClaimDecision`. |
| `src/app/api/uploads/claim-receipt/route.ts` (create) | Upload route. |
| `src/app/api/claims/route.ts` (create) | GET (scopes) + POST. |
| `src/app/api/claims/[id]/route.ts` (create) | PATCH + DELETE. |
| `src/app/api/claims/[id]/receipt/route.ts` (create) | Gated download. |
| `tests/validators.test.ts`, `tests/claims.test.ts` (create) | Unit tests. |
| `tests/db/claims-sql.test.ts` (create) | SQL-level tests on a throwaway local Postgres (skips without `TEST_DATABASE_URL`). |
| `src/components/ClaimBalanceCard.tsx`, `ClaimCard.tsx`, `ClaimForm.tsx` (create) | UI units. |
| `src/app/c/[slug]/claims/page.tsx`, `claims/new/page.tsx`, `admin/claims/page.tsx` (create) | Pages. |
| `src/app/c/[slug]/leave/page.tsx`, `admin/page.tsx`, `admin/staff/page.tsx` (modify) | Entry points and cap editor. |
| `CHANGELOG.md` (modify) | Entry. |

---

# PR 1 — storage generalisation + migration

### Task 1: Test harness + storage helpers keyed by kind

**Files:**
- Modify: `src/lib/storage.ts` (whole file)
- Create: `tests/storage.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces:
  ```ts
  export type AttachmentKind = 'medical-cert' | 'claim-receipt';
  export function isValidOwnAttachmentUrl(kind: AttachmentKind, url: string, cafeId: string, userId: string): boolean;
  export function isTrustedBlobUrl(url: string): boolean;
  export function attachmentContentType(pathnameOrUrl: string): string;
  export function uploadAttachment(kind: AttachmentKind, opts: { userId: string; cafeId: string; file: File | Blob; filename: string; contentType?: string }): Promise<{ url: string; pathname: string }>;
  export function deleteAttachment(urlOrPathname: string): Promise<void>;
  export function streamGatedAttachment(url: string, logId: string): Promise<Response>;
  ```
- Removed: `uploadMedicalCert`, `deleteMedicalCert`, `isValidOwnCertUrl`, `certContentType`, `ownerFromPath` (unused).

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only && git checkout -b refactor/attachment-storage
```

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:

```json
"test": "tsx --test 'tests/**/*.test.ts'"
```

- [ ] **Step 3: Write the failing test**

Create `tests/storage.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidOwnAttachmentUrl,
  isTrustedBlobUrl,
  attachmentContentType,
} from '../src/lib/storage';

const CAFE = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const HOST = 'https://abc123.public.blob.vercel-storage.com';

test('own medical-cert URL is accepted', () => {
  assert.equal(
    isValidOwnAttachmentUrl('medical-cert', `${HOST}/medical-certificates/${CAFE}/${USER}/1-mc-x.pdf`, CAFE, USER),
    true,
  );
});

test('own claim-receipt URL is accepted', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/claim-receipts/${CAFE}/${USER}/1-r-x.jpg`, CAFE, USER),
    true,
  );
});

test('kind prefixes do not cross', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/medical-certificates/${CAFE}/${USER}/1-mc-x.pdf`, CAFE, USER),
    false,
  );
});

test('another user path is rejected', () => {
  assert.equal(
    isValidOwnAttachmentUrl('claim-receipt', `${HOST}/claim-receipts/${CAFE}/other/1-r-x.jpg`, CAFE, USER),
    false,
  );
});

test('wrong host, http, and garbage are rejected', () => {
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', `https://evil.com/claim-receipts/${CAFE}/${USER}/x.jpg`, CAFE, USER), false);
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', `http://abc.public.blob.vercel-storage.com/claim-receipts/${CAFE}/${USER}/x.jpg`, CAFE, USER), false);
  assert.equal(isValidOwnAttachmentUrl('claim-receipt', 'not a url', CAFE, USER), false);
});

test('isTrustedBlobUrl only trusts https on the blob host', () => {
  assert.equal(isTrustedBlobUrl(`${HOST}/anything`), true);
  assert.equal(isTrustedBlobUrl('https://evil.com/x'), false);
  assert.equal(isTrustedBlobUrl('http://abc.public.blob.vercel-storage.com/x'), false);
});

test('content type derives from extension only', () => {
  assert.equal(attachmentContentType(`${HOST}/a/b.PDF?x=1`), 'application/pdf');
  assert.equal(attachmentContentType('x.jpeg'), 'image/jpeg');
  assert.equal(attachmentContentType('x.heic'), 'image/heic');
  assert.equal(attachmentContentType('x.exe'), 'application/octet-stream');
});
```

- [ ] **Step 4: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `isValidOwnAttachmentUrl` is not exported.

- [ ] **Step 5: Rewrite `src/lib/storage.ts`**

```ts
/**
 * Vercel Blob storage for user attachments (medical certificates, claim receipts).
 *
 * Pattern: server-side upload only. The uploading user POSTs a multipart form to
 * an /api/uploads/* route; the route validates auth + size + mime, then calls
 * uploadAttachment() and returns the blob URL to that user so they can attach it
 * to their own record.
 *
 * Reads NEVER hand the raw blob URL to clients. Record endpoints rewrite the URL
 * to a gated route (e.g. /api/leave-requests/[id]/attachment) which authorizes
 * and streams the file via streamGatedAttachment(). The blob is created with a
 * random suffix so the underlying public URL is unguessable as defense in depth.
 *
 * Path scheme: {prefix}/{cafe_id}/{user_id}/{timestamp}-{filename}-{suffix}
 */

import { put, del } from '@vercel/blob';

export type AttachmentKind = 'medical-cert' | 'claim-receipt';

const PREFIX: Record<AttachmentKind, string> = {
  'medical-cert': 'medical-certificates',
  'claim-receipt': 'claim-receipts',
};

// Vercel Blob public URLs live on this host suffix. Locking attachment fetches to
// it prevents SSRF: a client cannot make the server fetch an internal address by
// supplying a URL whose PATH matches but whose HOST is arbitrary.
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

/**
 * Validate a client-supplied attachment URL on WRITE: it must be https, on our
 * Blob host, and inside the caller's own path for this kind and café. This is
 * the gate that stops a user attaching another user's blob or an arbitrary URL.
 */
export function isValidOwnAttachmentUrl(kind: AttachmentKind, url: string, cafeId: string, userId: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.hostname !== BLOB_HOST_SUFFIX.slice(1) && !u.hostname.endsWith(BLOB_HOST_SUFFIX)) return false;
  return u.pathname.startsWith(`/${PREFIX[kind]}/${cafeId}/${userId}/`);
}

/** Defense-in-depth check on READ: only ever fetch https URLs on our Blob host. */
export function isTrustedBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/** Safe Content-Type for serving, derived from the path extension (never trust upstream). */
export function attachmentContentType(pathnameOrUrl: string): string {
  const ext = pathnameOrUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'heic': return 'image/heic';
    default: return 'application/octet-stream';
  }
}

export async function uploadAttachment(
  kind: AttachmentKind,
  opts: { userId: string; cafeId: string; file: File | Blob; filename: string; contentType?: string },
): Promise<{ url: string; pathname: string }> {
  const safeName = opts.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${PREFIX[kind]}/${opts.cafeId}/${opts.userId}/${Date.now()}-${safeName}`;
  const result = await put(key, opts.file, {
    // Vercel Blob 0.27 only supports public access. Reads are gated by the
    // app-layer route; the random suffix makes the raw URL unguessable.
    access: 'public',
    addRandomSuffix: true,
    contentType: opts.contentType,
  });
  return { url: result.url, pathname: result.pathname };
}

export async function deleteAttachment(urlOrPathname: string): Promise<void> {
  await del(urlOrPathname);
}

/**
 * Fetch a stored attachment server-side and stream it back as a forced download.
 * Callers MUST have already authorized the requester. `logId` is only used in
 * error logs so a failure can be traced to a record without leaking the URL.
 */
export async function streamGatedAttachment(url: string, logId: string): Promise<Response> {
  // Defense in depth: never fetch anything but an https URL on our Blob host,
  // even if a malformed value somehow reached the DB. Closes SSRF at read time.
  if (!isTrustedBlobUrl(url)) {
    console.error('attachment rejected: untrusted URL', logId);
    return Response.json({ error: 'Attachment unavailable' }, { status: 502 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    console.error('attachment fetch failed', logId, upstream.status);
    return Response.json({ error: 'Attachment unavailable' }, { status: 502 });
  }

  // Serve as a forced download with a type derived from the path (never the
  // upstream header) and nosniff, so a file cannot execute as HTML on our origin.
  const headers = new Headers();
  headers.set('Content-Type', attachmentContentType(url));
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  headers.set('Content-Disposition', 'attachment');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');

  return new Response(upstream.body, { status: 200, headers });
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: all `tests/storage.test.ts` cases PASS. (`tsc` will now fail on callers — fixed in Task 2.)

- [ ] **Step 7: Commit**

```bash
git add package.json src/lib/storage.ts tests/storage.test.ts
git commit -m "refactor(storage): key blob helpers by attachment kind, add gated stream helper"
```

---

### Task 2: Shared upload handler and caller updates

**Files:**
- Create: `src/lib/uploads.ts`
- Modify: `src/app/api/uploads/medical-cert/route.ts` (whole file)
- Modify: `src/app/api/leave-requests/[id]/attachment/route.ts` (whole file)
- Modify: `src/app/api/leave-requests/route.ts` (import at top; call at "Validate ANY supplied attachment")
- Modify: `src/app/api/leave-requests/[id]/route.ts` (import at top; call in DELETE)

**Interfaces:**
- Produces: `export async function handleAttachmentUpload(kind: AttachmentKind, req: Request): Promise<Response>` — full route handler including auth and error mapping. Response `{ url, pathname }` on 200.

- [ ] **Step 1: Create `src/lib/uploads.ts`**

```ts
import { NextResponse } from 'next/server';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { uploadAttachment, type AttachmentKind } from '@/lib/storage';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']);

const DEFAULT_NAME: Record<AttachmentKind, string> = {
  'medical-cert': 'mc',
  'claim-receipt': 'receipt',
};

/**
 * Shared body for /api/uploads/* routes: authenticate, gate size and mime type,
 * upload under the caller's own path for `kind`, return the blob URL.
 */
export async function handleAttachmentUpload(kind: AttachmentKind, req: Request): Promise<Response> {
  try {
    const ctx = await requireTenantUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit` }, { status: 413 });
    }
    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 415 });
    }

    const { url, pathname } = await uploadAttachment(kind, {
      userId: ctx.userId,
      cafeId: ctx.cafeId,
      file,
      filename: file.name || DEFAULT_NAME[kind],
      contentType: file.type || undefined,
    });

    return NextResponse.json({ url, pathname });
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error(`uploads/${kind} error`, e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Replace `src/app/api/uploads/medical-cert/route.ts`**

```ts
import { handleAttachmentUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handleAttachmentUpload('medical-cert', req);
}
```

- [ ] **Step 3: Replace `src/app/api/leave-requests/[id]/attachment/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { streamGatedAttachment } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/leave-requests/[id]/attachment
 *
 * Streams a leave request's medical certificate to authorized callers only:
 * the requester, or a manager/owner of the same cafe. The raw Vercel Blob URL
 * is never exposed to the client.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ user_id: string; attachment_url: string | null }>`
      SELECT user_id, attachment_url
        FROM leave_requests
       WHERE id = ${id} AND cafe_id = ${ctx.cafeId}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.attachment_url) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Requester may view their own; managers and owners may view anyone's in the cafe.
    const isOwnRow = row.user_id === ctx.userId;
    const isManagerOrOwner = ctx.role === 'manager' || ctx.role === 'owner';
    if (!isOwnRow && !isManagerOrOwner) {
      throw new AuthError('forbidden', 'Not allowed to view this attachment');
    }

    return streamGatedAttachment(row.attachment_url, id);
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('leave-requests attachment GET error', e);
    return NextResponse.json({ error: 'Failed to load attachment' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Update the two leave route callers**

In `src/app/api/leave-requests/route.ts`:
- import line: `import { isValidOwnCertUrl } from '@/lib/storage';` → `import { isValidOwnAttachmentUrl } from '@/lib/storage';`
- call: `!isValidOwnCertUrl(attachment_url, ctx.cafeId, ctx.userId)` → `!isValidOwnAttachmentUrl('medical-cert', attachment_url, ctx.cafeId, ctx.userId)`

In `src/app/api/leave-requests/[id]/route.ts`:
- import: `import { deleteMedicalCert } from '@/lib/storage';` → `import { deleteAttachment } from '@/lib/storage';`
- call in DELETE: `deleteMedicalCert(row.attachment_url)` → `deleteAttachment(row.attachment_url)`

- [ ] **Step 5: Verify nothing else references the old names**

Run: `grep -rn "uploadMedicalCert\|deleteMedicalCert\|isValidOwnCertUrl\|certContentType\|ownerFromPath" src`
Expected: no output.

- [ ] **Step 6: Type-check, lint, test, build**

Run: `npx tsc --noEmit && npx eslint --quiet . && npm test && npx next build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/uploads.ts src/app/api/uploads/medical-cert/route.ts "src/app/api/leave-requests/[id]/attachment/route.ts" src/app/api/leave-requests/route.ts "src/app/api/leave-requests/[id]/route.ts"
git commit -m "refactor(uploads): share upload handler and gated download across attachment kinds"
```

---

### Task 3: Migration file + schema.sql

**Files:**
- Create: `db/migrations/2026-09-03-medical-claims.sql`
- Modify: `db/schema.sql` — add the column inside `cafe_memberships` after `medical_leave_balance`; add the table block after the LEAVE REQUESTS block; add triggers beside the leave triggers.

- [ ] **Step 1: Create the migration**

```sql
-- Medical claims: per-employee yearly cap on cafe_memberships, one row per
-- receipt in medical_claims. Balance is deducted ON APPROVAL only.
-- Additive. Rollback: DROP TABLE medical_claims; ALTER TABLE cafe_memberships DROP COLUMN medical_claim_balance;

BEGIN;

ALTER TABLE public.cafe_memberships
  ADD COLUMN IF NOT EXISTS medical_claim_balance NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (medical_claim_balance >= 0);

CREATE TABLE IF NOT EXISTS public.medical_claims (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cafe_id         UUID NOT NULL REFERENCES public.cafes(id),
    user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receipt_date    DATE NOT NULL,
    amount_claimed  NUMERIC(10,2) NOT NULL CHECK (amount_claimed > 0 AND amount_claimed <= 9999.99),
    amount_approved NUMERIC(10,2)          CHECK (amount_approved IS NULL OR
                                                 (amount_approved > 0 AND amount_approved <= amount_claimed)),
    description     TEXT,
    receipt_url     TEXT NOT NULL,            -- Vercel Blob URL; never sent raw to clients
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
    decided_by      UUID REFERENCES public.profiles(id),
    decided_at      TIMESTAMPTZ,
    decision_note   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT medical_claims_decided_consistent CHECK (
      (status = 'pending'  AND amount_approved IS NULL     AND decided_by IS NULL     AND decided_at IS NULL) OR
      (status = 'approved' AND amount_approved IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL) OR
      (status = 'rejected' AND amount_approved IS NULL     AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_claims_cafe_user   ON public.medical_claims(cafe_id, user_id);
CREATE INDEX IF NOT EXISTS idx_claims_cafe_status ON public.medical_claims(cafe_id, status);

DROP TRIGGER IF EXISTS medical_claims_updated_at ON public.medical_claims;
CREATE TRIGGER medical_claims_updated_at
    BEFORE UPDATE ON public.medical_claims
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.log_claim_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID := public.current_actor_id();
BEGIN
    IF actor IS NULL THEN
        RETURN NEW;
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.audit_log (actor_id, impersonator_id, cafe_id, action, entity, entity_id, diff)
        VALUES (
            actor,
            public.current_impersonator_id(),
            NEW.cafe_id,
            CASE NEW.status
                WHEN 'approved' THEN 'approve'
                WHEN 'rejected' THEN 'reject'
                ELSE 'update'
            END,
            'medical_claim',
            NEW.id,
            jsonb_build_object(
              'status', jsonb_build_array(OLD.status, NEW.status),
              'amount_approved', NEW.amount_approved
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_claim_change ON public.medical_claims;
CREATE TRIGGER audit_claim_change
    AFTER UPDATE ON public.medical_claims
    FOR EACH ROW EXECUTE FUNCTION public.log_claim_change();

COMMIT;
```

- [ ] **Step 2: Mirror into `db/schema.sql`**

Add `medical_claim_balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (medical_claim_balance >= 0),` directly after `medical_leave_balance` inside `CREATE TABLE public.cafe_memberships`. Add a `-- MEDICAL CLAIMS` section containing the `CREATE TABLE` and two `CREATE INDEX` statements after the leave-requests indexes. Add the `medical_claims_updated_at` trigger after `leave_requests_updated_at`, and the `log_claim_change` function + `audit_claim_change` trigger after `audit_leave_change`.

`audit_log.entity` and `.action` are unconstrained TEXT (checked in `db/schema.sql`), so
`'medical_claim'` / `'approve'` insert cleanly from the trigger.

- [ ] **Step 3: Prove both files load on a throwaway database**

```bash
createdb cafeos_schema_check
psql -v ON_ERROR_STOP=1 -q -d cafeos_schema_check -f db/schema.sql
psql -v ON_ERROR_STOP=1 -q -d cafeos_schema_check -f db/migrations/2026-09-03-medical-claims.sql   # must be a no-op re-run
psql -d cafeos_schema_check -c "\d medical_claims" | head -30
dropdb cafeos_schema_check
```
Expected: no errors; the table shows 14 columns, 2 indexes, 2 triggers, 4 check constraints (plus FKs).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-09-03-medical-claims.sql db/schema.sql
git commit -m "db: medical_claims table and membership claim cap (additive, unused until feature ships)"
```

---

### Task 4: PR 1 verification and hand-off

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx eslint --quiet . && npm test && npx next build`
Expected: clean.

- [ ] **Step 2: Real-flow check of the refactor (no behaviour change) — needs a non-production Neon-compatible database**

`@vercel/postgres` speaks Neon's WebSocket/HTTP protocol and will NOT connect to plain
local Postgres, so this step needs the database decision in **Task 15 Step 1** (Neon branch
vs local wsproxy) — ask Nyan now, before PR 1, not later. Create `.env.test.local` as in
Task 10 Step 1 with `POSTGRES_URL`/`DATABASE_URL` pointing at that database and
`TELEGRAM_BOT_TOKEN=` explicitly empty, then:

```bash
set -a; source .env.test.local; set +a; npx next dev
```
In the browser: log in as a staff user, apply for medical leave with a PDF, confirm the request appears, open "View Proof" and confirm the download arrives; as owner, open the same attachment. Then cancel the request and confirm the blob is deleted (Vercel Blob dashboard, or `list()` in a scratch script).

- [ ] **Step 3: Push branch and open PR 1**

Confirm the branch with Nyan first (constitution rule), then:

```bash
git push -u origin refactor/attachment-storage
gh pr create --title "refactor: attachment helpers keyed by kind + medical_claims migration file" --body "$(cat <<'EOF'
## Summary
- `lib/storage.ts`: helpers keyed by `AttachmentKind`; `streamGatedAttachment` extracted from the leave attachment route
- `lib/uploads.ts`: shared upload handler; medical-cert route delegates to it
- `db/migrations/2026-09-03-medical-claims.sql` + `db/schema.sql`: additive migration (unused until the feature PR)
- `npm test` harness (`tsx --test`) with storage URL tests

No behaviour change. Prep for the medical-claims feature (spec: docs/superpowers/specs/2026-09-03-medical-claims-design.md).

## After merge
Apply the migration to production BEFORE merging the feature PR. Verify: `\d medical_claims` = 14 columns, 2 indexes, 2 triggers; `SELECT COUNT(*) FROM cafe_memberships WHERE medical_claim_balance <> 0` = 0.

## Verification
tsc, eslint --quiet, npm test, next build clean. Leave-with-MC submit, view attachment (staff + owner), cancel → blob deleted, checked in the browser against a non-production database.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**STOP.** PR 1 is Nyan's review gate. PR 2 tasks start only after PR 1 is merged and the production migration is applied.

---

# PR 2 — the feature

### Task 5: Money + date primitives

**Files:**
- Modify: `src/lib/validators.ts` (append)
- Create: `src/lib/money.ts`
- Modify: `src/lib/dateUtils.ts` (append)
- Modify: `src/app/api/leave-requests/route.ts` (use `todayInSingapore`)
- Create: `tests/validators.test.ts`, `tests/money.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // validators.ts
  export function parseMoney(input: unknown, label: string, opts?: { max?: number; allowZero?: boolean }): number;
  // money.ts
  export function toMoney(v: string | number | null): number;          // null → 0
  export function toMoneyOrNull(v: string | number | null): number | null;
  export function formatSGD(n: number): string;                        // "S$1,234.50"
  // dateUtils.ts
  export function todayInSingapore(): string;                          // "YYYY-MM-DD"
  ```

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only && git checkout feat/medical-claims && git rebase main
```
(The branch already holds the spec commit.)

- [ ] **Step 2: Write failing tests**

`tests/validators.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, ValidationError } from '../src/lib/validators';

test('parseMoney accepts whole and 2dp amounts as string or number', () => {
  assert.equal(parseMoney('12', 'Amount'), 12);
  assert.equal(parseMoney('12.5', 'Amount'), 12.5);
  assert.equal(parseMoney(12.34, 'Amount'), 12.34);
  assert.equal(parseMoney(' 9999.99 ', 'Amount'), 9999.99);
});

test('parseMoney rejects zero, negatives, 3dp, non-numeric, and over max', () => {
  for (const bad of ['0', '-1', '1.234', 'abc', '', '1e3', '10000', null, undefined, {}]) {
    assert.throws(() => parseMoney(bad, 'Amount'), ValidationError, String(bad));
  }
});

test('parseMoney honours allowZero and max', () => {
  assert.equal(parseMoney('0', 'Cap', { allowZero: true, max: 99999.99 }), 0);
  assert.equal(parseMoney('50000', 'Cap', { allowZero: true, max: 99999.99 }), 50000);
  assert.throws(() => parseMoney('100000', 'Cap', { allowZero: true, max: 99999.99 }), ValidationError);
});
```

`tests/money.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMoney, toMoneyOrNull, formatSGD } from '../src/lib/money';

test('toMoney converts pg NUMERIC strings', () => {
  assert.equal(toMoney('123.40'), 123.4);
  assert.equal(toMoney('0.00'), 0);
  assert.equal(toMoney(null), 0);
  assert.equal(toMoney(7), 7);
});

test('toMoneyOrNull keeps null', () => {
  assert.equal(toMoneyOrNull(null), null);
  assert.equal(toMoneyOrNull('5.50'), 5.5);
});

test('formatSGD', () => {
  assert.equal(formatSGD(1234.5), 'S$1,234.50');
  assert.equal(formatSGD(0), 'S$0.00');
});
```

Run: `npm test` → FAIL (modules/functions missing).

- [ ] **Step 3: Implement**

Append to `src/lib/validators.ts`:

```ts
// Money: digits with an optional 1–2 digit fraction. Checked on the STRING so
// "1.234" is rejected outright instead of being silently rounded.
const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Parse a currency amount (SGD). Rejects anything that is not a plain decimal
 * with at most two places. Default range is (0, 9999.99]; pass `allowZero`
 * for caps/balances and `max` to widen.
 */
export function parseMoney(
  input: unknown,
  label: string,
  opts: { max?: number; allowZero?: boolean } = {},
): number {
  const raw = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : '';
  if (!MONEY_RE.test(raw)) {
    throw new ValidationError(`${label} must be an amount with at most 2 decimal places`);
  }
  const n = Number(raw);
  const max = opts.max ?? 9999.99;
  if (n === 0 && !opts.allowZero) throw new ValidationError(`${label} must be greater than 0`);
  if (n > max) throw new ValidationError(`${label} cannot exceed ${max.toFixed(2)}`);
  return n;
}
```

Create `src/lib/money.ts`:

```ts
/**
 * Money helpers. Postgres NUMERIC arrives from @vercel/postgres as a string;
 * convert exactly once at the API boundary. Never do arithmetic on the result —
 * balance math lives in SQL.
 */

export function toMoney(v: string | number | null): number {
  if (v === null) return 0;
  return Math.round(Number(v) * 100) / 100;
}

export function toMoneyOrNull(v: string | number | null): number | null {
  return v === null ? null : toMoney(v);
}

const SGD = new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatSGD(n: number): string {
  return `S$${SGD.format(n)}`;
}
```

Append to `src/lib/dateUtils.ts`:

```ts
/**
 * Today's calendar date in Singapore as YYYY-MM-DD. "Today" must be evaluated
 * in SGT, not UTC — before 08:00 SGT the UTC date is still yesterday.
 */
export function todayInSingapore(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}
```

In `src/app/api/leave-requests/route.ts`, replace the two lines

```ts
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
```
with
```ts
    const today = todayInSingapore();
```
and add `import { todayInSingapore } from '@/lib/dateUtils';` to the imports. Keep the explanatory comment above it.

- [ ] **Step 4: Run tests + tsc**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators.ts src/lib/money.ts src/lib/dateUtils.ts src/app/api/leave-requests/route.ts tests/validators.test.ts tests/money.test.ts
git commit -m "feat(claims): money parsing/formatting and SGT today helper"
```

---

### Task 6: Types, session user, admin user routes, stats

**Files:**
- Modify: `src/lib/database.types.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/context/AuthContext.tsx`
- Modify: `src/app/api/admin/users/route.ts`
- Modify: `src/app/api/admin/users/[id]/route.ts`
- Modify: `src/app/api/admin/stats/route.ts`

**Interfaces:**
- Produces: `SessionUser.medical_claim_balance: number` (server + client), `User.medical_claim_balance: number`, `MedicalClaim`, `ClaimStatus`, `ClaimProfile`; `PATCH /api/admin/users/[id]` accepts `medical_claim_balance`; `GET /api/admin/stats` returns `pendingClaims`.

- [ ] **Step 1: `database.types.ts`**

In `profiles.Row` add `medical_claim_balance: number;` after `medical_leave_balance: number;`. In `profiles.Insert` and `profiles.Update` add `medical_claim_balance?: number;` in the same position.

Append at the end of the file:

```ts
export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface ClaimProfile {
  full_name: string;
  role: UserRole;
  medical_claim_balance: number;
}

/** API shape of a medical claim. Money fields are numbers; receipt_url is the gated route. */
export interface MedicalClaim {
  id: string;
  user_id: string;
  receipt_date: string;
  amount_claimed: number;
  amount_approved: number | null;
  description: string | null;
  receipt_url: string;
  status: ClaimStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  profile?: ClaimProfile;
}
```

- [ ] **Step 2: `auth.ts`**

- `SessionUser`: add `medical_claim_balance: number;` after `medical_leave_balance`.
- `interface Employment`: add `medical_claim_balance: string;` (NUMERIC → string).
- `NO_EMPLOYMENT`: add `medical_claim_balance: '0',`.
- Both membership `SELECT`s (in `login` and `getCurrentUser`): change `m.job_title, m.annual_leave_balance, m.medical_leave_balance, m.hourly_rate` → `m.job_title, m.annual_leave_balance, m.medical_leave_balance, m.medical_claim_balance, m.hourly_rate`.
- `buildUser`: add `medical_claim_balance: Number(employment.medical_claim_balance),` after `medical_leave_balance`.
- `employmentOf`: add `medical_claim_balance: m.medical_claim_balance,`.

- [ ] **Step 3: `AuthContext.tsx`**

In the client `SessionUser` interface add `medical_claim_balance: number;` after `medical_leave_balance`.

- [ ] **Step 4: `api/admin/users/route.ts`**

- `ProfileRow`: add `medical_claim_balance: string;` after `medical_leave_balance`.
- `serialise`: return `{ ...r, hourly_rate: …, medical_claim_balance: Number(r.medical_claim_balance) }`.
- GET `SELECT`: `m.annual_leave_balance, m.medical_leave_balance, m.medical_claim_balance, m.hourly_rate,`.
- POST response object: add `medical_claim_balance: 0,` after `hourly_rate` (new memberships default to 0).

- [ ] **Step 5: `api/admin/users/[id]/route.ts`**

- Import `parseMoney` from `@/lib/validators`.
- `employmentUpdate` type: add `medical_claim_balance?: number;`.
- After the `medical_leave_balance` block add:
  ```ts
  if ('medical_claim_balance' in body) {
    employmentUpdate.medical_claim_balance = parseMoney(body.medical_claim_balance, 'Medical claim cap', { allowZero: true, max: 99999.99 });
  }
  ```
- The employment `UPDATE`: add a line `medical_claim_balance = COALESCE($8, medical_claim_balance),` after `medical_leave_balance = COALESCE($4, …)` — renumber: `employment_active = COALESCE($7, …)` stays; use `$8` for the cap and shift `WHERE cafe_id = $9 AND user_id = $10`. Parameter array becomes:
  ```ts
  [
    'job_title' in employmentUpdate,
    employmentUpdate.job_title ?? null,
    employmentUpdate.annual_leave_balance ?? null,
    employmentUpdate.medical_leave_balance ?? null,
    'hourly_rate' in employmentUpdate,
    employmentUpdate.hourly_rate ?? null,
    employmentUpdate.employment_active ?? null,
    employmentUpdate.medical_claim_balance === undefined ? null : employmentUpdate.medical_claim_balance.toFixed(2),
    ctx.cafeId,
    id,
  ]
  ```
  and the SQL line is `medical_claim_balance = COALESCE($8::numeric, medical_claim_balance),`.
- Final `SELECT`: add `medical_claim_balance: string;` to the row type, select `m.medical_claim_balance`, and return `medical_claim_balance: Number(r.medical_claim_balance)` alongside the `hourly_rate` conversion.

- [ ] **Step 6: `api/admin/stats/route.ts`**

Add to the row type `pending_claims: number;`, to the SQL
```sql
(SELECT COUNT(*) FROM medical_claims WHERE status = 'pending' AND cafe_id = ${ctx.cafeId})::int AS pending_claims,
```
and to the response `pendingClaims: r.pending_claims,`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx eslint --quiet . && grep -rn "medical_leave_balance" src --include='*.ts' --include='*.tsx'`
Expected: tsc/eslint clean. The grep lists every place leave balances are projected; the only
membership SELECT outside the files above is `src/app/api/profiles/route.ts` (team directory,
privacy-restricted). It intentionally does NOT get the claim cap — nothing claims-related reads it.
`admin/manifest`, `admin/archive`, `src/app/page.tsx` touch leave balances only; leave them.

- [ ] **Step 8: Commit**

```bash
git add src/lib/database.types.ts src/lib/auth.ts src/context/AuthContext.tsx src/app/api/admin/users/route.ts "src/app/api/admin/users/[id]/route.ts" src/app/api/admin/stats/route.ts
git commit -m "feat(claims): surface medical_claim_balance on session and admin user APIs; pending claims stat"
```

---

### Task 7: Claims row helpers + notifications + upload route

**Files:**
- Create: `src/lib/claims.ts`
- Modify: `src/lib/notifications.ts` (append a Claims section)
- Create: `src/app/api/uploads/claim-receipt/route.ts`
- Create: `tests/claims.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // claims.ts
  export interface ClaimRow { id; user_id; receipt_date; amount_claimed: string; amount_approved: string | null; description; receipt_url; status; decided_by; decided_at; decision_note; created_at; updated_at }
  export interface JoinedClaimRow extends ClaimRow { profile_full_name: string; profile_role: UserRole; profile_claim_balance: string }
  export const CLAIM_COLUMNS: string;          // "c.id, c.user_id, ..." for SELECTs aliased c
  export const CLAIM_RETURNING: string;        // unaliased column list for RETURNING
  export function serialiseClaim(r: ClaimRow | JoinedClaimRow): MedicalClaim;
  export class RequestConflictError extends Error {}
  // notifications.ts
  export function notifyClaimSubmitted(args: { cafeId: string; requesterName: string; amount: number; receiptDate: string }): Promise<void>;
  export function notifyClaimDecision(args: { cafeId: string; requesterUserId: string; amountClaimed: number; amountApproved: number | null; approved: boolean; note: string | null }): Promise<void>;
  ```

- [ ] **Step 1: Failing test for `serialiseClaim`**

`tests/claims.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialiseClaim, type JoinedClaimRow } from '../src/lib/claims';

const base = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  user_id: 'u1',
  receipt_date: '2026-09-01',
  amount_claimed: '80.00',
  amount_approved: null,
  description: null,
  receipt_url: 'https://x.public.blob.vercel-storage.com/claim-receipts/c/u/1-r.jpg',
  status: 'pending' as const,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

test('serialiseClaim converts money and gates the receipt URL', () => {
  const out = serialiseClaim(base);
  assert.equal(out.amount_claimed, 80);
  assert.equal(out.amount_approved, null);
  assert.equal(out.receipt_url, `/api/claims/${base.id}/receipt`);
  assert.equal(out.profile, undefined);
});

test('serialiseClaim attaches profile when joined columns are present', () => {
  const joined: JoinedClaimRow = {
    ...base, status: 'approved', amount_approved: '50.00',
    profile_full_name: 'Ana', profile_role: 'staff', profile_claim_balance: '250.00',
  };
  const out = serialiseClaim(joined);
  assert.equal(out.amount_approved, 50);
  assert.deepEqual(out.profile, { full_name: 'Ana', role: 'staff', medical_claim_balance: 250 });
});
```

Run: `npm test` → FAIL.

- [ ] **Step 2: Create `src/lib/claims.ts`**

```ts
import type { MedicalClaim, ClaimStatus, UserRole } from '@/lib/database.types';
import { toMoney, toMoneyOrNull } from '@/lib/money';

/** Raised when a concurrent request already changed the row's state under us. → HTTP 409. */
export class RequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestConflictError';
  }
}

/** Raw row as returned by @vercel/postgres — NUMERIC columns are strings. */
export interface ClaimRow {
  id: string;
  user_id: string;
  receipt_date: string;
  amount_claimed: string;
  amount_approved: string | null;
  description: string | null;
  receipt_url: string;
  status: ClaimStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface JoinedClaimRow extends ClaimRow {
  profile_full_name: string;
  profile_role: UserRole;
  profile_claim_balance: string;
}

const COLS = [
  'id', 'user_id', 'receipt_date', 'amount_claimed', 'amount_approved', 'description',
  'receipt_url', 'status', 'decided_by', 'decided_at', 'decision_note', 'created_at', 'updated_at',
];

/** Column list for SELECTs where medical_claims is aliased `c`. */
export const CLAIM_COLUMNS = COLS.map((c) => `c.${c}`).join(', ');
/** Column list for RETURNING / unaliased SELECTs. */
export const CLAIM_RETURNING = COLS.join(', ');

/** Joined profile columns (profiles aliased `p`, cafe_memberships aliased `m`). */
export const CLAIM_PROFILE_COLUMNS =
  'p.full_name AS profile_full_name, m.role AS profile_role, m.medical_claim_balance AS profile_claim_balance';

function isJoined(r: ClaimRow | JoinedClaimRow): r is JoinedClaimRow {
  return 'profile_full_name' in r;
}

/**
 * Convert a DB row to the API shape: money as numbers and the raw Blob URL
 * replaced by the gated read route so the durable public URL never reaches a client.
 */
export function serialiseClaim(r: ClaimRow | JoinedClaimRow): MedicalClaim {
  const out: MedicalClaim = {
    id: r.id,
    user_id: r.user_id,
    receipt_date: r.receipt_date,
    amount_claimed: toMoney(r.amount_claimed),
    amount_approved: toMoneyOrNull(r.amount_approved),
    description: r.description,
    receipt_url: `/api/claims/${r.id}/receipt`,
    status: r.status,
    decided_by: r.decided_by,
    decided_at: r.decided_at,
    decision_note: r.decision_note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (isJoined(r)) {
    out.profile = {
      full_name: r.profile_full_name,
      role: r.profile_role,
      medical_claim_balance: toMoney(r.profile_claim_balance),
    };
  }
  return out;
}
```

Run: `npm test` → PASS.

- [ ] **Step 3: Append to `src/lib/notifications.ts`**

Add `import { formatSGD } from '@/lib/money';` at the top, then append:

```ts
// ---------------------------------------------------------------------------
// Medical claim notifications
// ---------------------------------------------------------------------------

interface NotifyClaimSubmittedArgs {
  cafeId: string;
  requesterName: string;
  amount: number;
  receiptDate: string;
}

/** Notify the café's owners that a medical claim is waiting for a decision. */
export async function notifyClaimSubmitted(args: NotifyClaimSubmittedArgs): Promise<void> {
  const [recipients, slug] = await Promise.all([
    getOwnerRecipients(args.cafeId),
    getCafeSlug(args.cafeId),
  ]);
  if (recipients.length === 0) {
    console.warn(`notifyClaimSubmitted: no linked owner recipients in cafe ${args.cafeId}`);
    return;
  }
  const reviewUrl = slug ? `${baseUrl()}/c/${slug}/admin/claims` : baseUrl();
  const text = `🧾 <b>New Medical Claim</b>\n\n${esc(args.requesterName)} submitted a claim for <b>${esc(formatSGD(args.amount))}</b> (receipt dated ${SHORT_DATE(args.receiptDate)}).\n\nReview: ${reviewUrl}`;
  await Promise.all(recipients.map((chatId) => sendTelegram(chatId, text)));
}

interface NotifyClaimDecisionArgs {
  cafeId: string;
  requesterUserId: string;
  amountClaimed: number;
  amountApproved: number | null;
  approved: boolean;
  note: string | null;
}

/** Notify the claimant of an approval (possibly at a lower amount) or rejection. */
export async function notifyClaimDecision(args: NotifyClaimDecisionArgs): Promise<void> {
  const { rows } = await sql<{ telegram_chat_id: string }>`
    SELECT telegram_chat_id FROM profiles
     WHERE id = ${args.requesterUserId}
       AND telegram_chat_id IS NOT NULL
     LIMIT 1
  `;
  if (rows.length === 0) return;

  let text: string;
  if (args.approved) {
    const approved = args.amountApproved ?? args.amountClaimed;
    const partial = approved < args.amountClaimed
      ? ` (you claimed ${esc(formatSGD(args.amountClaimed))})`
      : '';
    text = `✅ <b>Claim Approved</b>\n\nYour medical claim of <b>${esc(formatSGD(approved))}</b>${partial} has been approved and deducted from your claim balance.`;
  } else {
    text = `❌ <b>Claim Rejected</b>\n\nYour medical claim of <b>${esc(formatSGD(args.amountClaimed))}</b> has been rejected.`;
  }
  if (args.note) text += `\n\nNote: ${esc(args.note)}`;

  await sendTelegram(rows[0].telegram_chat_id, text);
}
```

- [ ] **Step 4: Create `src/app/api/uploads/claim-receipt/route.ts`**

```ts
import { handleAttachmentUpload } from '@/lib/uploads';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  return handleAttachmentUpload('claim-receipt', req);
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm test && npx tsc --noEmit && npx eslint --quiet .`

```bash
git add src/lib/claims.ts src/lib/notifications.ts src/app/api/uploads/claim-receipt/route.ts tests/claims.test.ts
git commit -m "feat(claims): row serialiser, Telegram notifications, receipt upload route"
```

---

### Task 8: `GET` + `POST /api/claims`

**Files:**
- Create: `src/app/api/claims/route.ts`

**Interfaces:**
- Consumes: `CLAIM_COLUMNS`, `CLAIM_RETURNING`, `CLAIM_PROFILE_COLUMNS`, `serialiseClaim`, `ClaimRow`, `JoinedClaimRow` (Task 7); `parseMoney`, `todayInSingapore` (Task 5); `isValidOwnAttachmentUrl` (Task 1); `notifyClaimSubmitted` (Task 7).
- Produces: `GET ?scope=mine|pending|history` → `{ claims: MedicalClaim[] }`; `POST` → 201 `{ claim: MedicalClaim }`.

- [ ] **Step 1: Add a plain-text query helper to `src/lib/db.ts`**

`@vercel/postgres` only exposes a tagged template (`sql\`…\``), which cannot splice a
column list. Append to `src/lib/db.ts`:

```ts
/**
 * Parameterised query from a plain SQL string. Use when the statement needs a
 * compile-time column-list constant (never user input) that the tagged template
 * cannot splice. Pooled, non-transactional — same as `sql`.
 */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) {
  return vercelDb.query<T>(text, params as never[]);
}
```

- [ ] **Step 2: Write the route**

```ts
import { NextResponse, after } from 'next/server';
import { query, withTenantTx, isDbUnavailable } from '@/lib/db';
import { requireTenantUser, requireManagerInCafe, AuthError } from '@/lib/auth';
import { ValidationError, parseMoney } from '@/lib/validators';
import { isValidOwnAttachmentUrl } from '@/lib/storage';
import { todayInSingapore } from '@/lib/dateUtils';
import { notifyClaimSubmitted } from '@/lib/notifications';
import {
  CLAIM_COLUMNS, CLAIM_RETURNING, CLAIM_PROFILE_COLUMNS,
  serialiseClaim, type ClaimRow, type JoinedClaimRow,
} from '@/lib/claims';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESCRIPTION = 500;

function parseReceiptDate(input: unknown): string {
  if (typeof input !== 'string' || !DATE_RE.test(input)) {
    throw new ValidationError('receipt_date must be YYYY-MM-DD');
  }
  if (Number.isNaN(Date.parse(input + 'T00:00:00Z'))) {
    throw new ValidationError('receipt_date is not a valid date');
  }
  if (input > todayInSingapore()) throw new ValidationError('receipt_date cannot be in the future');
  return input;
}

function parseDescription(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input !== 'string') throw new ValidationError('description must be text');
  const t = input.trim();
  if (t.length === 0) return null;
  if (t.length > MAX_DESCRIPTION) throw new ValidationError(`description must be at most ${MAX_DESCRIPTION} characters`);
  return t;
}

function errorResponse(e: unknown, where: string): Response {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof AuthError) {
    const status = e.code === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: e.message }, { status });
  }
  if (isDbUnavailable(e)) {
    console.error(`claims ${where}: database unavailable`, e);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  console.error(`claims ${where} error`, e);
  return NextResponse.json({ error: `Failed to ${where === 'GET' ? 'load' : 'create'} claims` }, { status: 500 });
}

/**
 * GET /api/claims?scope=mine|pending|history
 *  - mine    : caller's own claims in this café
 *  - pending : manager+owner — all pending claims (managers read-only; enforced in PATCH)
 *  - history : manager+owner — decided claims; managers see staff/part-timer rows only
 */
export async function GET(req: Request) {
  try {
    const ctx = await requireTenantUser();
    const scope = new URL(req.url).searchParams.get('scope') ?? 'mine';

    if (scope === 'mine') {
      const { rows } = await query<ClaimRow>(
        `SELECT ${CLAIM_RETURNING}
           FROM medical_claims
          WHERE user_id = $1 AND cafe_id = $2
          ORDER BY created_at DESC`,
        [ctx.userId, ctx.cafeId],
      );
      return NextResponse.json({ claims: rows.map(serialiseClaim) });
    }

    if (scope === 'pending' || scope === 'history') {
      requireManagerInCafe(ctx);
      const statuses = scope === 'pending' ? ['pending'] : ['approved', 'rejected'];
      const roles = ctx.role === 'owner'
        ? ['staff', 'manager', 'owner', 'part_timer']
        : ['staff', 'part_timer'];
      const order = scope === 'pending' ? 'ASC' : 'DESC';
      const { rows } = await query<JoinedClaimRow>(
        `SELECT ${CLAIM_COLUMNS}, ${CLAIM_PROFILE_COLUMNS}
           FROM medical_claims c
           JOIN profiles p ON p.id = c.user_id
           JOIN cafe_memberships m ON m.user_id = p.id AND m.cafe_id = c.cafe_id
          WHERE c.cafe_id = $1
            AND c.status = ANY($2::text[])
            AND m.role   = ANY($3::text[])
          ORDER BY c.created_at ${order}`,
        [ctx.cafeId, statuses, roles],
      );
      return NextResponse.json({ claims: rows.map(serialiseClaim) });
    }

    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  } catch (e) {
    return errorResponse(e, 'GET');
  }
}

/**
 * POST /api/claims
 * Body: { receipt_date, amount_claimed, description?, receipt_url }
 *  - Rejects if amount exceeds balance minus the sum of the caller's pending claims,
 *    checked under FOR UPDATE on the membership row.
 *  - Owner's own claim: inserted as approved and deducted in the same transaction.
 *  - Otherwise pending; nothing is deducted until approval.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireTenantUser();
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const receipt_date = parseReceiptDate(body.receipt_date);
    const amount = parseMoney(body.amount_claimed, 'Amount');
    const description = parseDescription(body.description);
    const receipt_url = typeof body.receipt_url === 'string' ? body.receipt_url : '';
    if (!receipt_url) throw new ValidationError('A receipt is required');
    if (!isValidOwnAttachmentUrl('claim-receipt', receipt_url, ctx.cafeId, ctx.userId)) {
      throw new ValidationError('Invalid receipt URL');
    }

    const amountParam = amount.toFixed(2);
    const autoApprove = ctx.role === 'owner';

    const { created, requesterName } = await withTenantTx(ctx, async (tx) => {
      const { rows: balRows } = await tx.query<{ full_name: string; medical_claim_balance: string }>(
        `SELECT p.full_name, m.medical_claim_balance
           FROM cafe_memberships m
           JOIN profiles p ON p.id = m.user_id
          WHERE m.user_id = $1 AND m.cafe_id = $2
          FOR UPDATE OF m`,
        [ctx.userId, ctx.cafeId],
      );
      if (balRows.length === 0) throw new AuthError('unauthorized', 'Membership not found');

      // Available = balance − pending (nothing is reserved in the DB; the lock above
      // serialises concurrent submits so two cannot both pass this check).
      const { rows: availRows } = await tx.query<{ available: string; pending: string }>(
        `SELECT (m.medical_claim_balance - COALESCE(SUM(c.amount_claimed), 0))::numeric(10,2) AS available,
                COALESCE(SUM(c.amount_claimed), 0)::numeric(10,2) AS pending
           FROM cafe_memberships m
           LEFT JOIN medical_claims c
             ON c.user_id = m.user_id AND c.cafe_id = m.cafe_id AND c.status = 'pending'
          WHERE m.user_id = $1 AND m.cafe_id = $2
          GROUP BY m.medical_claim_balance`,
        [ctx.userId, ctx.cafeId],
      );
      const available = Number(availRows[0].available);
      const pending = Number(availRows[0].pending);
      if (amount > available) {
        throw new ValidationError(
          `Claim exceeds available balance. Available S$${available.toFixed(2)}` +
          (pending > 0 ? ` (after S$${pending.toFixed(2)} pending).` : '.'),
        );
      }

      const insert = await tx.query<ClaimRow>(
        `INSERT INTO medical_claims
            (cafe_id, user_id, receipt_date, amount_claimed, description, receipt_url,
             status, amount_approved, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::boolean THEN 'approved' ELSE 'pending' END,
                 CASE WHEN $7::boolean THEN $4::numeric ELSE NULL END,
                 CASE WHEN $7::boolean THEN $2::uuid ELSE NULL END,
                 CASE WHEN $7::boolean THEN NOW() ELSE NULL END)
         RETURNING ${CLAIM_RETURNING}`,
        [ctx.cafeId, ctx.userId, receipt_date, amountParam, description, receipt_url, autoApprove],
      );

      if (autoApprove) {
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [amountParam, ctx.userId, ctx.cafeId],
        );
      }
      return { created: insert.rows[0], requesterName: balRows[0].full_name };
    });

    if (created.status === 'pending') {
      const cafeId = ctx.cafeId;
      after(async () => {
        try {
          await notifyClaimSubmitted({ cafeId, requesterName, amount, receiptDate: created.receipt_date });
        } catch (err) {
          console.error('notifyClaimSubmitted error:', err);
        }
      });
    }

    return NextResponse.json({ claim: serialiseClaim(created) }, { status: 201 });
  } catch (e) {
    return errorResponse(e, 'POST');
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint --quiet .`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/claims/route.ts src/lib/db.ts
git commit -m "feat(claims): list and submit endpoints with locked over-submit check"
```

---

### Task 9: `PATCH` + `DELETE /api/claims/[id]` and the receipt route

**Files:**
- Create: `src/app/api/claims/[id]/route.ts`
- Create: `src/app/api/claims/[id]/receipt/route.ts`

**Interfaces:**
- Consumes: Task 7 helpers, `requireOwnerInCafe`, `deleteAttachment`, `streamGatedAttachment`, `notifyClaimDecision`.
- Produces: `PATCH { action:'approve', amount_approved? } | { action:'reject', note? }` → `{ claim }`; `DELETE` → `{ ok: true }`; `GET …/receipt` → file stream.

- [ ] **Step 1: Write `[id]/route.ts`**

```ts
import { NextResponse, after } from 'next/server';
import { query, withTenantTx, isDbUnavailable } from '@/lib/db';
import { requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import { ValidationError, parseMoney } from '@/lib/validators';
import { deleteAttachment } from '@/lib/storage';
import { notifyClaimDecision } from '@/lib/notifications';
import { CLAIM_RETURNING, RequestConflictError, serialiseClaim, type ClaimRow } from '@/lib/claims';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 500;

async function loadRow(id: string, cafeId: string): Promise<ClaimRow | null> {
  const { rows } = await query<ClaimRow>(
    `SELECT ${CLAIM_RETURNING} FROM medical_claims WHERE id = $1 AND cafe_id = $2 LIMIT 1`,
    [id, cafeId],
  );
  return rows[0] ?? null;
}

function errorResponse(e: unknown, where: string): Response {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof RequestConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof AuthError) {
    const status = e.code === 'unauthorized' ? 401 : 403;
    return NextResponse.json({ error: e.message }, { status });
  }
  if (isDbUnavailable(e)) {
    console.error(`claims/[id] ${where}: database unavailable`, e);
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  console.error(`claims/[id] ${where} error`, e);
  return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 });
}

/**
 * PATCH /api/claims/[id]  (owner only)
 * Body: { action: 'approve', amount_approved? } | { action: 'reject', note? }
 *  - approve: amount defaults to amount_claimed, must be ≤ it and ≤ current balance;
 *             deducts the approved amount from the claimant's membership.
 *  - reject : status only, optional note. No balance change.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const action = body.action;
    if (action !== 'approve' && action !== 'reject') {
      throw new ValidationError('action must be "approve" or "reject"');
    }

    const row = await loadRow(id, ctx.cafeId);
    if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    if (row.status !== 'pending') {
      return NextResponse.json({ error: `Claim already ${row.status}` }, { status: 409 });
    }

    let note: string | null = null;
    if (action === 'reject' && body.note != null) {
      if (typeof body.note !== 'string') throw new ValidationError('note must be text');
      note = body.note.trim() || null;
      if (note && note.length > MAX_NOTE) throw new ValidationError(`note must be at most ${MAX_NOTE} characters`);
    }

    const claimed = Number(row.amount_claimed);
    const approvedAmount = action === 'approve'
      ? (body.amount_approved == null ? claimed : parseMoney(body.amount_approved, 'Approved amount'))
      : null;
    if (approvedAmount !== null && approvedAmount > claimed) {
      throw new ValidationError(`Approved amount cannot exceed the claimed S$${claimed.toFixed(2)}`);
    }

    const updated = await withTenantTx(ctx, async (tx) => {
      // Lock the claim and re-read status: two concurrent decisions serialise here.
      const lock = await tx.query<{ status: ClaimRow['status']; user_id: string }>(
        `SELECT status, user_id FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const cur = lock.rows[0];
      if (!cur) throw new RequestConflictError('Claim not found');
      if (cur.status !== 'pending') throw new RequestConflictError(`Claim already ${cur.status}`);

      if (action === 'approve') {
        const amountParam = approvedAmount!.toFixed(2);
        // Lock the claimant's membership and re-check the balance: the owner may have
        // edited the cap since submission.
        const bal = await tx.query<{ medical_claim_balance: string }>(
          `SELECT medical_claim_balance FROM cafe_memberships
            WHERE user_id = $1 AND cafe_id = $2 FOR UPDATE`,
          [cur.user_id, ctx.cafeId],
        );
        if (!bal.rows[0]) throw new RequestConflictError('Claimant is no longer a member');
        const balance = Number(bal.rows[0].medical_claim_balance);
        if (approvedAmount! > balance) {
          throw new ValidationError(
            `Balance is S$${balance.toFixed(2)}; cannot approve S$${amountParam}. Lower the amount or raise the cap.`,
          );
        }
        const r = await tx.query<ClaimRow>(
          `UPDATE medical_claims
              SET status = 'approved', amount_approved = $1::numeric,
                  decided_by = $2, decided_at = NOW(), decision_note = NULL
            WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
            RETURNING ${CLAIM_RETURNING}`,
          [amountParam, ctx.userId, id, ctx.cafeId],
        );
        if (!r.rows[0]) throw new RequestConflictError('Claim already decided');
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [amountParam, cur.user_id, ctx.cafeId],
        );
        return r.rows[0];
      }

      const r = await tx.query<ClaimRow>(
        `UPDATE medical_claims
            SET status = 'rejected', decided_by = $1, decided_at = NOW(), decision_note = $2
          WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
          RETURNING ${CLAIM_RETURNING}`,
        [ctx.userId, note, id, ctx.cafeId],
      );
      if (!r.rows[0]) throw new RequestConflictError('Claim already decided');
      return r.rows[0];
    });

    const cafeId = ctx.cafeId;
    after(async () => {
      try {
        await notifyClaimDecision({
          cafeId,
          requesterUserId: updated.user_id,
          amountClaimed: Number(updated.amount_claimed),
          amountApproved: updated.amount_approved === null ? null : Number(updated.amount_approved),
          approved: updated.status === 'approved',
          note: updated.decision_note,
        });
      } catch (err) {
        console.error('notifyClaimDecision error:', err);
      }
    });

    return NextResponse.json({ claim: serialiseClaim(updated) });
  } catch (e) {
    return errorResponse(e, 'PATCH');
  }
}

/**
 * DELETE /api/claims/[id]
 *  - Claimant may cancel their own PENDING claim (no balance change).
 *  - Owner may delete any pending claim (no balance change) or purge a decided one;
 *    purging an APPROVED claim refunds amount_approved.
 *  - Receipt blob removed best-effort after commit.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const row = await loadRow(id, ctx.cafeId);
    if (!row) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });

    const isOwnRow = row.user_id === ctx.userId;
    const isOwner = ctx.role === 'owner';
    if (!isOwner) {
      if (!isOwnRow) throw new AuthError('forbidden', 'Cannot delete this claim');
      if (row.status !== 'pending') throw new AuthError('forbidden', 'Cannot delete a decided claim');
    }

    await withTenantTx(ctx, async (tx) => {
      const lock = await tx.query<{ status: ClaimRow['status']; amount_approved: string | null; user_id: string }>(
        `SELECT status, amount_approved, user_id FROM medical_claims
          WHERE id = $1 AND cafe_id = $2 FOR UPDATE`,
        [id, ctx.cafeId],
      );
      const cur = lock.rows[0];
      if (!cur) throw new RequestConflictError('Claim not found');
      if (!isOwner && cur.status !== 'pending') throw new RequestConflictError(`Claim already ${cur.status}`);

      const del = await tx.query(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [id, ctx.cafeId]);
      if (del.rowCount === 1 && cur.status === 'approved' && cur.amount_approved !== null) {
        await tx.query(
          `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance + $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`,
          [cur.amount_approved, cur.user_id, ctx.cafeId],
        );
      }
    });

    deleteAttachment(row.receipt_url).catch((err) => console.error('blob cleanup failed', err));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, 'DELETE');
  }
}
```

- [ ] **Step 2: Write `[id]/receipt/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';
import { streamGatedAttachment } from '@/lib/storage';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/claims/[id]/receipt
 * Streams the receipt to the claimant or a manager/owner of the same café.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows } = await sql<{ user_id: string; receipt_url: string }>`
      SELECT user_id, receipt_url FROM medical_claims
       WHERE id = ${id} AND cafe_id = ${ctx.cafeId}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });

    const isOwnRow = row.user_id === ctx.userId;
    const isManagerOrOwner = ctx.role === 'manager' || ctx.role === 'owner';
    if (!isOwnRow && !isManagerOrOwner) {
      throw new AuthError('forbidden', 'Not allowed to view this receipt');
    }

    return streamGatedAttachment(row.receipt_url, id);
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('claims receipt GET error', e);
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx eslint --quiet .`

```bash
git add "src/app/api/claims/[id]/route.ts" "src/app/api/claims/[id]/receipt/route.ts"
git commit -m "feat(claims): owner decide/delete endpoints and gated receipt download"
```

---

### Task 10: SQL-level tests on a throwaway local Postgres

**Files:**
- Create: `tests/db/claims-sql.test.ts`
- Create: `.env.test.local` (git-ignored; verify with `git check-ignore .env.test.local` — if not ignored, add `.env*.local` is already in `.gitignore`; confirm before creating)

Why: the repo has no integration harness. This test re-runs the exact SQL from Tasks 8–9 (copied verbatim — if you change a query in the route, change it here) against a local database seeded from `db/schema.sql`, so the locking, balance and constraint behaviour is proven before any browser run. It **skips** when `TEST_DATABASE_URL` is unset so `npm test` still passes in CI-less environments.

- [ ] **Step 1: Local database**

```bash
brew services start postgresql@18 2>/dev/null || pg_ctl -D /opt/homebrew/var/postgresql@18 start
createdb cafeos_test
psql -v ON_ERROR_STOP=1 -q -d cafeos_test -f db/schema.sql
```

Create `.env.test.local` (never commit; contains no production values):

```
TEST_DATABASE_URL=postgres://localhost/cafeos_test
POSTGRES_URL=postgres://localhost/cafeos_test
JWT_SECRET=local-test-secret-not-for-prod
DEFAULT_PIN=123456
# MUST be an explicit empty string, not omitted: Next.js also loads .env.local for any
# key the shell leaves undefined, and .env.local holds the PRODUCTION bot token.
# sendTelegram() returns early on an empty token, so no real owner is messaged.
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
# BLOB_READ_WRITE_TOKEN: copy from .env.local ONLY for the browser runs (Task 4 Step 2,
# Task 15); uploads land under claim-receipts/… and are deleted afterwards.
# For the browser runs, POSTGRES_URL / DATABASE_URL must point at the database chosen
# in Task 15 Step 1 (Neon branch or wsproxy) — plain local Postgres will not connect.
```

- [ ] **Step 2: Write the test**

`tests/db/claims-sql.test.ts`:

```ts
/**
 * SQL-level tests for the medical-claims flow, run against a throwaway Postgres
 * seeded from db/schema.sql. Skipped unless TEST_DATABASE_URL is set.
 *
 * The statements below are the SAME strings the routes execute. If you edit a
 * query in src/app/api/claims, edit it here too — the point is to test what ships.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const url = process.env.TEST_DATABASE_URL;
// `skip` goes on the describe() only — node:test hooks accept no skip option.
const skip = url ? false : 'TEST_DATABASE_URL not set';

const pool = url ? new Pool({ connectionString: url }) : null;
let cafe = '';
let owner = '';
let staff = '';

async function q<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const r = await pool!.query(text, params);
  return r.rows as T[];
}

const RETURNING = 'id, user_id, receipt_date, amount_claimed, amount_approved, description, receipt_url, status, decided_by, decided_at, decision_note, created_at, updated_at';

const AVAILABLE_SQL = `SELECT (m.medical_claim_balance - COALESCE(SUM(c.amount_claimed), 0))::numeric(10,2) AS available,
                COALESCE(SUM(c.amount_claimed), 0)::numeric(10,2) AS pending
           FROM cafe_memberships m
           LEFT JOIN medical_claims c
             ON c.user_id = m.user_id AND c.cafe_id = m.cafe_id AND c.status = 'pending'
          WHERE m.user_id = $1 AND m.cafe_id = $2
          GROUP BY m.medical_claim_balance`;

const INSERT_SQL = `INSERT INTO medical_claims
            (cafe_id, user_id, receipt_date, amount_claimed, description, receipt_url,
             status, amount_approved, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $7::boolean THEN 'approved' ELSE 'pending' END,
                 CASE WHEN $7::boolean THEN $4::numeric ELSE NULL END,
                 CASE WHEN $7::boolean THEN $2::uuid ELSE NULL END,
                 CASE WHEN $7::boolean THEN NOW() ELSE NULL END)
         RETURNING ${RETURNING}`;

const APPROVE_SQL = `UPDATE medical_claims
              SET status = 'approved', amount_approved = $1::numeric,
                  decided_by = $2, decided_at = NOW(), decision_note = NULL
            WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
            RETURNING ${RETURNING}`;

const REJECT_SQL = `UPDATE medical_claims
            SET status = 'rejected', decided_by = $1, decided_at = NOW(), decision_note = $2
          WHERE id = $3 AND cafe_id = $4 AND status = 'pending'
          RETURNING ${RETURNING}`;

const DEDUCT_SQL = `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance - $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`;
const REFUND_SQL = `UPDATE cafe_memberships SET medical_claim_balance = medical_claim_balance + $1::numeric
            WHERE user_id = $2 AND cafe_id = $3`;

const URL_FOR = (u: string) => `https://x.public.blob.vercel-storage.com/claim-receipts/${cafe}/${u}/1-r.jpg`;

async function balance(u: string): Promise<number> {
  const r = await q<{ b: string }>(`SELECT medical_claim_balance AS b FROM cafe_memberships WHERE user_id = $1 AND cafe_id = $2`, [u, cafe]);
  return Number(r[0].b);
}

async function submit(u: string, amount: string, auto = false) {
  const r = await q<{ id: string; status: string }>(INSERT_SQL, [cafe, u, '2026-09-01', amount, null, URL_FOR(u), auto]);
  if (auto) await q(DEDUCT_SQL, [amount, u, cafe]);
  return r[0];
}

describe('claims sql', { skip }, () => {

before(async () => {
  await q(`DELETE FROM medical_claims`);
  await q(`DELETE FROM cafe_memberships`);
  await q(`DELETE FROM cafes`);
  await q(`DELETE FROM profiles`);
  const c = await q<{ id: string }>(`INSERT INTO cafes (slug, name, status) VALUES ('t-cafe', 'T', 'active') RETURNING id`);
  cafe = c[0].id;
  const o = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ('+6511111111', 'Owner', 'x') RETURNING id`);
  owner = o[0].id;
  const s = await q<{ id: string }>(`INSERT INTO profiles (phone_e164, full_name, pin_hash) VALUES ('+6522222222', 'Staff', 'x') RETURNING id`);
  staff = s[0].id;
  await q(`INSERT INTO cafe_memberships (cafe_id, user_id, role, medical_claim_balance) VALUES ($1, $2, 'owner', 500), ($1, $3, 'staff', 300)`, [cafe, owner, staff]);
});

after(async () => { await pool?.end(); });

test('available = balance − pending', async () => {
  const a0 = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a0[0].available), 300);
  await submit(staff, '80.00');
  const a1 = await q<{ available: string; pending: string }>(AVAILABLE_SQL, [staff, cafe]);
  assert.equal(Number(a1[0].available), 220);
  assert.equal(Number(a1[0].pending), 80);
  assert.equal(await balance(staff), 300, 'submit must not deduct');
});

test('approve at lower amount deducts the approved amount only once', async () => {
  const c = await submit(staff, '100.00');
  const r = await q<{ status: string; amount_approved: string }>(APPROVE_SQL, ['60.00', owner, c.id, cafe]);
  assert.equal(r[0].status, 'approved');
  assert.equal(Number(r[0].amount_approved), 60);
  await q(DEDUCT_SQL, ['60.00', staff, cafe]);
  assert.equal(await balance(staff), 240);
  const again = await q(APPROVE_SQL, ['60.00', owner, c.id, cafe]);
  assert.equal(again.length, 0, 'second approve must match zero rows');
});

test('reject leaves the balance untouched and stores the note', async () => {
  const c = await submit(staff, '20.00');
  const r = await q<{ status: string; decision_note: string }>(REJECT_SQL, [owner, 'not a medical receipt', c.id, cafe]);
  assert.equal(r[0].status, 'rejected');
  assert.equal(r[0].decision_note, 'not a medical receipt');
  assert.equal(await balance(staff), 240);
});

test('owner auto-approve deducts immediately', async () => {
  const c = await submit(owner, '50.00', true);
  assert.equal(c.status, 'approved');
  assert.equal(await balance(owner), 450);
});

test('purging an approved claim refunds amount_approved', async () => {
  const c = await submit(staff, '30.00');
  await q(APPROVE_SQL, ['25.00', owner, c.id, cafe]);
  await q(DEDUCT_SQL, ['25.00', staff, cafe]);
  assert.equal(await balance(staff), 215);
  await q(`DELETE FROM medical_claims WHERE id = $1 AND cafe_id = $2`, [c.id, cafe]);
  await q(REFUND_SQL, ['25.00', staff, cafe]);
  assert.equal(await balance(staff), 240);
});

test('constraints: amount_approved > amount_claimed, negative balance, inconsistent decided rows', async () => {
  const c = await submit(staff, '10.00');
  await assert.rejects(q(APPROVE_SQL, ['10.01', owner, c.id, cafe]), /medical_claims_amount_approved_check|check constraint/i);
  await assert.rejects(q(DEDUCT_SQL, ['99999.00', staff, cafe]), /medical_claim_balance_check|check constraint/i);
  await assert.rejects(
    q(`UPDATE medical_claims SET status = 'approved' WHERE id = $1`, [c.id]),
    /medical_claims_decided_consistent/,
  );
});

test('two concurrent approves: exactly one wins', async () => {
  const c = await submit(staff, '40.00');
  const a = pool!.connect();
  const b = pool!.connect();
  const [ca, cb] = await Promise.all([a, b]);
  try {
    await ca.query('BEGIN'); await cb.query('BEGIN');
    const lockA = ca.query(`SELECT status FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`, [c.id, cafe]);
    const lockB = cb.query(`SELECT status FROM medical_claims WHERE id = $1 AND cafe_id = $2 FOR UPDATE`, [c.id, cafe]);
    await lockA;                                   // A holds the lock; B blocks
    const rA = await ca.query(APPROVE_SQL, ['40.00', owner, c.id, cafe]);
    await ca.query(DEDUCT_SQL, ['40.00', staff, cafe]);
    await ca.query('COMMIT');
    const sB = await lockB;                        // B now sees the committed state
    assert.equal(rA.rowCount, 1);
    assert.equal(sB.rows[0].status, 'approved');   // route would throw RequestConflictError here
    await cb.query('ROLLBACK');
  } finally {
    ca.release(); cb.release();
  }
  assert.equal(await balance(staff), 200);
});

}); // describe
```

- [ ] **Step 3: Run**

Run: `set -a; source .env.test.local; set +a; npm test`
Expected: all DB tests PASS. Then `npm test` without the env → DB tests reported as skipped, others pass.

- [ ] **Step 4: Commit**

```bash
git status --short   # confirm .env.test.local is NOT listed
git add tests/db/claims-sql.test.ts
git commit -m "test(claims): SQL-level tests for balance, decisions, constraints and concurrency"
```

---

### Task 11: UI components

**Files:**
- Create: `src/components/ClaimBalanceCard.tsx`
- Create: `src/components/ClaimCard.tsx`
- Create: `src/components/ClaimForm.tsx`

**Interfaces:**
- Consumes: `MedicalClaim` (Task 6), `formatSGD` (Task 5), `useAuth`, `useToast`, `openMedicalCert` from `lib/storageUtils` (already generic: opens a same-origin gated URL in a new tab).
- Produces:
  ```ts
  <ClaimBalanceCard available={number} pending={number} />
  <ClaimCard claim={MedicalClaim} userName?={string} onCancel?={() => void} onDelete?={() => void} />
  <ClaimForm />   // self-contained: upload + POST + redirect
  ```

- [ ] **Step 1: `ClaimBalanceCard.tsx`**

```tsx
'use client';

import { formatSGD } from '@/lib/money';

interface ClaimBalanceCardProps {
    available: number;   // membership balance (what approval can draw on)
    pending: number;     // sum of the caller's pending claims
}

export default function ClaimBalanceCard({ available, pending }: ClaimBalanceCardProps) {
    const remaining = Math.max(0, available - pending);
    return (
        <div className="stat-card">
            <div className="stat-label" style={{ textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                Medical Claim Balance
            </div>
            <div className="stat-value" style={{
                background: 'var(--color-black)',
                color: 'var(--color-neon)',
                fontSize: '2.25rem',
                padding: '1rem',
                width: '100%',
                fontFamily: 'var(--font-heading)',
            }}>
                {formatSGD(remaining)}
            </div>
            {pending > 0 && (
                <div className="text-muted mt-sm" style={{ fontSize: '0.8rem' }}>
                    {formatSGD(pending)} pending approval · {formatSGD(available)} on account
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: `ClaimCard.tsx`**

```tsx
'use client';

import { Receipt, Trash2, FileText } from 'lucide-react';
import type { MedicalClaim } from '@/lib/database.types';
import { formatSGD } from '@/lib/money';
import { formatDateShort } from '@/lib/dateUtils';
import { openMedicalCert } from '@/lib/storageUtils';

interface ClaimCardProps {
    claim: MedicalClaim;
    userName?: string;
    onCancel?: () => void;   // claimant, pending only
    onDelete?: () => void;   // owner purge, decided only
}

const STATUS: Record<MedicalClaim['status'], { label: string; className: string }> = {
    pending: { label: 'Awaiting Owner', className: 'badge-warning' },
    approved: { label: 'Approved', className: 'badge-success' },
    rejected: { label: 'Rejected', className: 'badge-danger' },
};

export default function ClaimCard({ claim, userName, onCancel, onDelete }: ClaimCardProps) {
    const status = STATUS[claim.status];
    const partial = claim.status === 'approved' && claim.amount_approved !== null && claim.amount_approved < claim.amount_claimed;

    return (
        <div className="card leave-request-card" style={{ position: 'relative' }}>
            {onCancel && claim.status === 'pending' && (
                <button
                    onClick={onCancel}
                    className="btn btn-ghost btn-sm"
                    style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--color-danger)', padding: '4px 8px' }}
                    title="Cancel claim"
                >
                    <Trash2 size={18} />
                </button>
            )}

            <div className="leave-request-header" style={{ paddingRight: onCancel ? '40px' : 0 }}>
                <div className="leave-request-type">
                    <Receipt size={20} className="leave-type-icon" />
                    <span>Medical Claim</span>
                </div>
                <span className={`badge ${status.className}`}>{status.label}</span>
            </div>

            {userName && (
                <div className="leave-request-user"><strong>{userName}</strong></div>
            )}

            <div className="leave-request-dates">
                <span className="leave-date-range">Receipt {formatDateShort(claim.receipt_date)}</span>
                <span className="leave-days">
                    {claim.status === 'approved' && claim.amount_approved !== null
                        ? formatSGD(claim.amount_approved)
                        : formatSGD(claim.amount_claimed)}
                </span>
            </div>

            {partial && (
                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                    Claimed {formatSGD(claim.amount_claimed)}, approved {formatSGD(claim.amount_approved!)}
                </div>
            )}

            <div className="leave-request-details" style={{ marginTop: '1rem', padding: '1rem', border: '2px solid black' }}>
                {claim.description && (
                    <div className="mb-sm">
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Description</div>
                        <div>{claim.description}</div>
                    </div>
                )}
                {claim.decision_note && (
                    <div className="mb-sm">
                        <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Owner note</div>
                        <div>{claim.decision_note}</div>
                    </div>
                )}
                <button
                    onClick={() => openMedicalCert(claim.receipt_url)}
                    className="btn btn-outline btn-sm btn-block"
                    style={{ marginTop: '0.5rem' }}
                >
                    <FileText size={16} />
                    <span>View Receipt</span>
                </button>
            </div>

            {onDelete && claim.status !== 'pending' && (
                <button
                    onClick={onDelete}
                    className="btn btn-ghost btn-sm btn-block mt-sm"
                    style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}
                >
                    <Trash2 size={14} />
                    <span>Delete Record</span>
                </button>
            )}
        </div>
    );
}
```

- [ ] **Step 3: `ClaimForm.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Upload, FileText } from 'lucide-react';
import { formatSGD } from '@/lib/money';
import type { MedicalClaim } from '@/lib/database.types';

async function jsonOrError(res: Response): Promise<unknown> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return res.json();
}

const MONEY_RE = /^\d{1,4}(\.\d{1,2})?$/;

export default function ClaimForm() {
    const { user, profile, refreshProfile } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();

    const [receiptDate, setReceiptDate] = useState('');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Today in Singapore, for the date input's max.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const balance = profile?.medical_claim_balance ?? 0;
    const available = Math.max(0, balance - pendingTotal);
    const amountNum = MONEY_RE.test(amount.trim()) ? Number(amount.trim()) : NaN;
    const overBudget = Number.isFinite(amountNum) && amountNum > available;

    useEffect(() => {
        (async () => {
            try {
                const data = await jsonOrError(await fetch('/api/claims?scope=mine')) as { claims: MedicalClaim[] };
                setPendingTotal(data.claims.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount_claimed, 0));
            } catch { /* the server enforces the limit regardless */ }
        })();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!user?.id) { setError('Your session has expired. Please log out and log in again.'); return; }
        if (!receiptDate) { setError('Please enter the receipt date'); return; }
        if (receiptDate > today) { setError('Receipt date cannot be in the future'); return; }
        if (!MONEY_RE.test(amount.trim()) || amountNum <= 0) { setError('Enter an amount like 45 or 45.50'); return; }
        if (overBudget) { setError(`You can claim up to ${formatSGD(available)} right now.`); return; }
        if (!file) { setError('Please attach the receipt'); return; }

        setSubmitting(true);
        setUploading(true);
        let receiptUrl: string;
        try {
            const form = new FormData();
            form.append('file', file);
            const data = await jsonOrError(await fetch('/api/uploads/claim-receipt', { method: 'POST', body: form })) as { url: string };
            receiptUrl = data.url;
        } catch (err) {
            setError(`Upload failed: ${err instanceof Error ? err.message : 'Upload failed'}`);
            setSubmitting(false);
            setUploading(false);
            return;
        }
        setUploading(false);

        try {
            await jsonOrError(await fetch('/api/claims', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receipt_date: receiptDate,
                    amount_claimed: amount.trim(),
                    description: description.trim() || null,
                    receipt_url: receiptUrl,
                }),
            }));
            await refreshProfile();
            router.push(`/c/${slug}/claims`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
            setSubmitting(false);
        }
    };

    return (
        <main className="page" style={{ overflowX: 'hidden' }}>
            <div className="container">
                <section className="page-header animate-in">
                    <h1 className="page-title">Submit a Claim</h1>
                    <p className="page-subtitle">Available now: {formatSGD(available)}</p>
                </section>

                <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                    <section className="section animate-in">
                        <div className="form-group">
                            <label htmlFor="receiptDate" className="form-label">Receipt Date</label>
                            <input
                                id="receiptDate"
                                type="date"
                                className="form-input"
                                value={receiptDate}
                                onChange={(e) => setReceiptDate(e.target.value)}
                                max={today}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="amount" className="form-label">Amount (S$)</label>
                            <input
                                id="amount"
                                type="text"
                                inputMode="decimal"
                                className="form-input"
                                placeholder="e.g. 45.50"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box' }}
                                required
                            />
                            {overBudget && (
                                <div className="form-error mt-sm">
                                    Exceeds your available balance of {formatSGD(available)}.
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="description" className="form-label">Description (optional)</label>
                            <textarea
                                id="description"
                                className="form-input"
                                rows={2}
                                maxLength={500}
                                placeholder="e.g. GP consultation, Raffles Medical"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                style={{ resize: 'none', width: '100%', boxSizing: 'border-box' }}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Receipt <span className="text-danger">*</span></label>
                            <div className="file-upload-wrapper" style={{ position: 'relative' }}>
                                <input
                                    type="file"
                                    id="receipt-upload"
                                    accept=".jpg,.jpeg,.png,.heic,.pdf"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 2 }}
                                    required
                                />
                                <div
                                    className="btn btn-outline btn-block"
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', border: '2px dashed var(--color-black)', background: file ? 'var(--color-concrete)' : 'transparent' }}
                                >
                                    {file ? (<><FileText size={20} /><span className="truncate">{file.name}</span></>)
                                          : (<><Upload size={20} /><span>Upload receipt (photo or PDF)</span></>)}
                                </div>
                            </div>
                            <p className="form-hint mt-xs text-muted" style={{ fontSize: '0.75rem' }}>
                                Supported: .jpg, .png, .heic, .pdf (Max 5MB)
                            </p>
                        </div>
                    </section>

                    {error && <div className="form-error mb-md">{error}</div>}

                    <section className="section animate-in">
                        <button
                            type="submit"
                            className="btn btn-primary btn-block btn-lg"
                            disabled={submitting || overBudget}
                        >
                            {submitting ? (uploading ? 'Uploading receipt…' : 'Submitting…') : 'Submit Claim'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-block mt-md" onClick={() => router.back()}>
                            Cancel
                        </button>
                    </section>
                </form>
            </div>
        </main>
    );
}
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx eslint --quiet .`

```bash
git add src/components/ClaimBalanceCard.tsx src/components/ClaimCard.tsx src/components/ClaimForm.tsx
git commit -m "feat(claims): balance card, claim card and submission form components"
```

---

### Task 12: Employee pages

**Files:**
- Create: `src/app/c/[slug]/claims/page.tsx`
- Create: `src/app/c/[slug]/claims/new/page.tsx`
- Modify: `src/app/c/[slug]/leave/page.tsx` (add entry button)

- [ ] **Step 1: `claims/page.tsx`**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import type { MedicalClaim } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import ClaimBalanceCard from '@/components/ClaimBalanceCard';
import ClaimCard from '@/components/ClaimCard';
import { BarChart3, Plus, Clock, History, Inbox, ArrowLeft } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { formatSGD } from '@/lib/money';

async function jsonOrError(res: Response): Promise<unknown> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return res.json();
}

export default function ClaimsPage() {
    const { user, profile, loading, refreshProfile } = useAuth();
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();

    const [claims, setClaims] = useState<MedicalClaim[]>([]);
    const [claimsLoading, setClaimsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (!loading && !user) router.push('/login');
    }, [user, loading, router]);

    const fetchClaims = useCallback(async () => {
        setFetchError(null);
        try {
            const data = await jsonOrError(await fetch('/api/claims?scope=mine')) as { claims: MedicalClaim[] };
            setClaims(data.claims ?? []);
        } catch (err) {
            console.error('Failed to load claims:', err);
            setFetchError('Failed to load your claims. Please try again.');
        } finally {
            setClaimsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchClaims();
    }, [user, fetchClaims]);

    const handleCancel = async (claim: MedicalClaim) => {
        if (!confirm(`Cancel this ${formatSGD(claim.amount_claimed)} claim? Nothing has been deducted yet.`)) return;
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, { method: 'DELETE' }));
            await refreshProfile();
            await fetchClaims();
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Failed to cancel claim.', 'error');
        }
    };

    if (loading || !user) {
        return <div className="loading" style={{ minHeight: '100vh' }}><div className="spinner" /></div>;
    }

    const pending = claims.filter(c => c.status === 'pending');
    const past = claims.filter(c => c.status !== 'pending');
    const pendingTotal = pending.reduce((s, c) => s + c.amount_claimed, 0);

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Medical Claims</h1>
                        <p className="page-subtitle">Submit receipts against your yearly cap</p>
                    </section>

                    <section className="section animate-in">
                        <h2 className="section-title"><BarChart3 size={20} /><span>Your Balance</span></h2>
                        <ClaimBalanceCard available={profile?.medical_claim_balance ?? 0} pending={pendingTotal} />
                    </section>

                    <section className="section animate-in">
                        <Link href={`/c/${slug}/claims/new`} className="btn btn-primary btn-block btn-lg">
                            <Plus size={20} /><span>Submit a Claim</span>
                        </Link>
                    </section>

                    {pending.length > 0 && (
                        <section className="section animate-in">
                            <h2 className="section-title"><Clock size={20} /><span>Pending</span></h2>
                            {pending.map(c => <ClaimCard key={c.id} claim={c} onCancel={() => handleCancel(c)} />)}
                        </section>
                    )}

                    <section className="section animate-in">
                        <h2 className="section-title"><History size={20} /><span>History</span></h2>
                        {fetchError ? (
                            <div className="empty-state">
                                <div className="empty-state-title" style={{ color: '#ef4444' }}>Failed to load claims</div>
                                <p style={{ marginBottom: '1rem' }}>{fetchError}</p>
                                <button className="btn btn-primary" onClick={fetchClaims}>Try again</button>
                            </div>
                        ) : claimsLoading ? (
                            <div className="loading"><div className="spinner" /></div>
                        ) : past.length > 0 ? (
                            past.map(c => <ClaimCard key={c.id} claim={c} />)
                        ) : pending.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state-icon"><Inbox size={48} /></div>
                                <div className="empty-state-title">No claims yet</div>
                                <p>Submit a receipt to get started</p>
                            </div>
                        ) : null}
                    </section>

                    <button className="btn btn-ghost btn-block mt-lg" onClick={() => router.push(`/c/${slug}/leave`)}>
                        <ArrowLeft size={18} /><span>Back to Leave</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
```

- [ ] **Step 2: `claims/new/page.tsx`**

```tsx
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import ClaimForm from '@/components/ClaimForm';

export default function NewClaimPage() {
    return (
        <>
            <Header />
            <ClaimForm />
            <BottomNav />
        </>
    );
}
```

- [ ] **Step 3: Entry button on the Leave page**

In `src/app/c/[slug]/leave/page.tsx`, import `Receipt` from `lucide-react` (add to the existing import), and directly after the "Apply for Leave" `<section>` add:

```tsx
                    <section className="section animate-in">
                        <Link href={`/c/${slug}/claims`} className="btn btn-secondary btn-block">
                            <Receipt size={20} />
                            <span>Medical Claims</span>
                        </Link>
                    </section>
```

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx eslint --quiet .`

```bash
git add "src/app/c/[slug]/claims/page.tsx" "src/app/c/[slug]/claims/new/page.tsx" "src/app/c/[slug]/leave/page.tsx"
git commit -m "feat(claims): employee claims page, new-claim page, entry from Leave"
```

---

### Task 13: Admin claims page + dashboard card

**Files:**
- Create: `src/app/c/[slug]/admin/claims/page.tsx`
- Modify: `src/app/c/[slug]/admin/page.tsx`

- [ ] **Step 1: `admin/claims/page.tsx`**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { MedicalClaim } from '@/lib/database.types';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import ClaimCard from '@/components/ClaimCard';
import { CheckCircle, ArrowLeft, Check, X } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { formatSGD } from '@/lib/money';

async function jsonOrError(res: Response): Promise<unknown> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return res.json();
}

type Tab = 'pending' | 'history';

export default function AdminClaimsPage() {
    const router = useRouter();
    const { slug } = useParams<{ slug: string }>();
    const toast = useToast();
    const { user, profile, loading: authLoading } = useAuth();

    const [tab, setTab] = useState<Tab>('pending');
    const [claims, setClaims] = useState<MedicalClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [amounts, setAmounts] = useState<Record<string, string>>({});

    const isOwner = profile?.role === 'owner';
    const isAdmin = profile?.role === 'manager' || profile?.role === 'owner';

    const load = useCallback(async (which: Tab) => {
        try {
            setLoading(true);
            setError(null);
            const data = await jsonOrError(await fetch(`/api/claims?scope=${which}`)) as { claims: MedicalClaim[] };
            setClaims(data.claims);
            setAmounts(Object.fromEntries(data.claims.map(c => [c.id, c.amount_claimed.toFixed(2)])));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load claims');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.push('/login'); return; }
        if (profile && !isAdmin) { router.push(`/c/${slug}/claims`); return; }
        if (isAdmin) load(tab);
    }, [user, profile, authLoading, isAdmin, load, router, slug, tab]);

    const decide = async (claim: MedicalClaim, action: 'approve' | 'reject') => {
        const body: Record<string, unknown> = { action };
        if (action === 'approve') {
            body.amount_approved = amounts[claim.id] ?? claim.amount_claimed.toFixed(2);
        } else {
            const note = prompt('Reason for rejecting (optional):');
            if (note === null) return;
            if (note.trim()) body.note = note.trim();
        }
        setProcessing(claim.id);
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }));
            toast(action === 'approve' ? 'Claim approved' : 'Claim rejected', 'success');
        } catch (err) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
        } finally {
            setProcessing(null);
            await load(tab);
        }
    };

    const purge = async (claim: MedicalClaim) => {
        const refund = claim.status === 'approved' && claim.amount_approved !== null
            ? ` ${formatSGD(claim.amount_approved)} will be returned to ${claim.profile?.full_name ?? 'the employee'}'s balance.`
            : '';
        if (!confirm(`Delete this ${claim.status} claim record?${refund}`)) return;
        setProcessing(claim.id);
        try {
            await jsonOrError(await fetch(`/api/claims/${claim.id}`, { method: 'DELETE' }));
        } catch (err) {
            toast(`Error: ${err instanceof Error ? err.message : 'An error occurred'}`, 'error');
        } finally {
            setProcessing(null);
            await load(tab);
        }
    };

    return (
        <>
            <Header />
            <main className="page">
                <div className="container">
                    <section className="page-header animate-in">
                        <h1 className="page-title">Medical Claims</h1>
                        <p className="page-subtitle">{isOwner ? 'Approve or reject receipts' : 'Owner approval required'}</p>
                    </section>

                    <div className="flex gap-sm mb-md">
                        <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('pending')}>Pending</button>
                        <button className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('history')}>History</button>
                    </div>

                    {error && (
                        <div className="form-error mb-md">
                            {error} <button className="text-button" onClick={() => load(tab)}>Retry</button>
                        </div>
                    )}

                    {loading ? (
                        <div className="loading"><div className="spinner" /></div>
                    ) : claims.length === 0 ? (
                        <div className="empty-state animate-in">
                            <div className="empty-state-icon"><CheckCircle size={48} /></div>
                            <div className="empty-state-title">{tab === 'pending' ? 'All caught up!' : 'No decided claims yet'}</div>
                        </div>
                    ) : (
                        <section className="section animate-in">
                            {claims.map(claim => (
                                <div key={claim.id} style={{ opacity: processing === claim.id ? 0.5 : 1 }}>
                                    <ClaimCard
                                        claim={claim}
                                        userName={`${claim.profile?.full_name ?? 'Unknown'} · balance ${formatSGD(claim.profile?.medical_claim_balance ?? 0)}`}
                                        onDelete={isOwner && tab === 'history' ? () => purge(claim) : undefined}
                                    />
                                    {isOwner && claim.status === 'pending' && (
                                        <div className="card mb-lg" style={{ marginTop: '-0.5rem' }}>
                                            <label className="form-label" htmlFor={`amt-${claim.id}`}>Approve amount (S$)</label>
                                            <input
                                                id={`amt-${claim.id}`}
                                                type="text"
                                                inputMode="decimal"
                                                className="form-input"
                                                value={amounts[claim.id] ?? ''}
                                                onChange={(e) => setAmounts(a => ({ ...a, [claim.id]: e.target.value }))}
                                                disabled={!!processing}
                                            />
                                            <div className="leave-request-actions mt-sm">
                                                <button className="btn btn-success btn-sm" onClick={() => decide(claim, 'approve')} disabled={!!processing}>
                                                    <Check size={16} /><span>Approve</span>
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => decide(claim, 'reject')} disabled={!!processing}>
                                                    <X size={16} /><span>Reject</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {!isOwner && claim.status === 'pending' && (
                                        <p className="text-muted mb-lg" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>Owner approval required</p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}

                    <button className="btn btn-ghost btn-block mt-lg" onClick={() => router.push(`/c/${slug}/admin`)}>
                        <ArrowLeft size={18} /><span>Back to Admin</span>
                    </button>
                </div>
            </main>
            <BottomNav />
        </>
    );
}
```

Note: `prompt()` is a browser modal; it is used here because the leave page already uses `confirm()` for the same class of decision and the page has no modal component. Do not trigger it from browser automation.

- [ ] **Step 2: Dashboard card and count**

In `src/app/c/[slug]/admin/page.tsx`:
- `AdminStats`: add `pendingClaims: number;` and initialise it to `0` in `useState`.
- Import `Receipt` from `lucide-react`.
- Inside the owner "Command Center" section, directly after the DECISION DESK card, add:

```tsx
                            <Link href={`${base}/admin/claims`} className="card mb-md" style={{ display: 'block', textDecoration: 'none' }}>
                                <div className="flex items-center gap-md">
                                    <div className="stat-icon"><Receipt size={28} /></div>
                                    <div style={{ flex: 1 }}>
                                        <div className="card-title">MEDICAL CLAIMS</div>
                                        <div className="card-subtitle">
                                            {stats.pendingClaims > 0 ? `${stats.pendingClaims} awaiting your decision` : 'Approve receipts against staff caps'}
                                        </div>
                                    </div>
                                    <ChevronRight size={20} className="text-muted" />
                                </div>
                            </Link>
```

- In the "General Actions" section, inside the `{!isOwner && (…)}` block after the leave card, add the same card with subtitle `'View pending claims (owner approves)'`.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx eslint --quiet .`

```bash
git add "src/app/c/[slug]/admin/claims/page.tsx" "src/app/c/[slug]/admin/page.tsx"
git commit -m "feat(claims): admin claims queue with owner approve/reject, dashboard entry"
```

---

### Task 14: Staff page cap editor

**Files:**
- Modify: `src/app/c/[slug]/admin/staff/page.tsx`

- [ ] **Step 1: State + type**

- `StaffRow` `Pick<…>`: add `| 'medical_claim_balance'`.
- Import `Receipt` from `lucide-react`.
- Add state beside `editingRate`/`rateInput`:
  ```ts
  const [editingCap, setEditingCap] = useState<string | null>(null);
  const [capInput, setCapInput] = useState('');
  ```
- Add handler after `updateBalance`:
  ```ts
  const saveClaimCap = async (userId: string) => {
      setUpdating(userId);
      const updated = await patchUser(userId, { medical_claim_balance: capInput.trim() }, { errorPrefix: 'Failed to update claim cap' });
      if (updated) {
          setStaff(staff.map(s => (s.id === userId ? { ...s, medical_claim_balance: updated.medical_claim_balance } : s)));
          setEditingCap(null);
      }
      setUpdating(null);
  };
  ```

- [ ] **Step 2: Markup**

Directly after the closing `</div>` of `.balance-controls` (the two leave steppers), add:

```tsx
                                        <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--color-concrete)', marginTop: '0.5rem' }}>
                                            {editingCap === member.id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Receipt size={14} />
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-gray)' }}>S$</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={capInput}
                                                        onChange={e => setCapInput(e.target.value)}
                                                        placeholder="e.g. 300"
                                                        autoFocus
                                                        style={{ width: 90, border: '1px solid var(--color-black)', padding: '3px 6px', fontSize: '0.85rem', borderRadius: 0 }}
                                                    />
                                                    <button onClick={() => saveClaimCap(member.id)} className="btn btn-xs btn-primary" disabled={!!updating}>Save</button>
                                                    <button onClick={() => setEditingCap(null)} className="btn btn-xs btn-outline">Cancel</button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                                    <Receipt size={14} />
                                                    <span style={{ color: 'var(--color-gray)' }}>Medical claim cap:</span>
                                                    <span style={{ fontWeight: 600 }}>S${member.medical_claim_balance.toFixed(2)}</span>
                                                    <button
                                                        onClick={() => { setCapInput(member.medical_claim_balance.toFixed(2)); setEditingCap(member.id); }}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.8rem', textDecoration: 'underline', padding: 0 }}
                                                        disabled={!!updating}
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
                                            )}
                                        </div>
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx eslint --quiet . && npx next build`

```bash
git add "src/app/c/[slug]/admin/staff/page.tsx"
git commit -m "feat(claims): owner edits each member's medical claim cap on the staff page"
```

---

### Task 15: Browser verification, CHANGELOG, PR 2

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Decide the database for the browser run — ASK NYAN**

`@vercel/postgres` talks WebSocket/HTTP to Neon and will not connect to plain local Postgres. Options, in order of preference:

1. A **Neon branch** of the production project (isolated copy; real user rows so login works; creating one is an account action — ask first). Put its connection strings in `.env.test.local` as `POSTGRES_URL` and `DATABASE_URL`. **Leave `TELEGRAM_BOT_TOKEN` unset.**
2. Local Postgres behind the Neon WebSocket proxy: `docker run -d -p 5433:80 -e APPEND_PORT=host.docker.internal:5432 -e ALLOW_ADDR_REGEX='.*' ghcr.io/neondatabase/wsproxy:latest`, then in `src/lib/db.ts` (dev only, guarded by `process.env.NEON_LOCAL_WS`) set `neonConfig.wsProxy = () => 'localhost:5433/v1'`, `neonConfig.useSecureWebSocket = false`, `neonConfig.pipelineTLS = false`, `neonConfig.pipelineConnect = false`. Seed a café + owner + staff via SQL with `pin_hash` from `hashPin` (run `npx tsx -e` against `src/lib/auth`).

Do not proceed until Nyan has chosen.

- [ ] **Step 2: Run the app against that database**

```bash
set -a; source .env.test.local; set +a; npx next dev
```
Ensure `BLOB_READ_WRITE_TOKEN` is present for this run only (uploads go under `claim-receipts/…`).

- [ ] **Step 3: Walk the real flows** (record each as pass/fail in the PR body)

1. Owner → Staff page → set a staff member's claim cap to 300.00 → reload → persists.
2. Staff → Leave page → "Medical Claims" → balance shows S$300.00 → Submit a Claim → date today, amount 80, JPEG → success → pending card shows; balance card shows S$220.00 available, S$80.00 pending.
3. Staff → submit 250 → server rejects with the "Available S$220.00 (after S$80.00 pending)" message.
4. Owner → Dashboard shows "1 awaiting your decision" → Medical Claims → row shows staff name and balance → change amount to 60 → Approve → History tab shows Claimed S$80.00, approved S$60.00.
5. Staff → refresh → balance S$240.00, history shows the partial approval.
6. Staff → View Receipt opens the download via `/api/claims/{id}/receipt`; log out, log in as a different staff member, paste that URL → 403.
7. Manager → Medical Claims page shows the pending queue with "Owner approval required", no buttons; `PATCH` from the manager's session via devtools fetch → 403.
8. Owner → reject a claim with a note → staff sees the note; balance unchanged.
9. Owner → own claim 50 → appears approved immediately, own balance reduced by 50.
10. Owner → History → Delete Record on the approved 60 claim → staff balance back to 300.00.
11. Clean up: delete uploaded test blobs (`list({ prefix: 'claim-receipts/' })` + `del` in a scratch script), drop the Neon branch or stop the proxy, remove `BLOB_READ_WRITE_TOKEN` from `.env.test.local`.

- [ ] **Step 4: CHANGELOG entry**

Prepend to `CHANGELOG.md` under a new dated heading:

```markdown
## 2026-09-03 — Medical claims

### Summary
Employees submit medical receipts with an amount; the owner approves (optionally at a lower
amount) or rejects; approval deducts a per-employee yearly cap set on the staff page.
Delivered in two PRs: PR #<n1> (attachment helpers keyed by kind + migration file, no behaviour
change) and PR #<n2> (feature). Migration applied to prod between the two.

### Schema (applied BEFORE PR #<n2>)
- `db/migrations/2026-09-03-medical-claims.sql` — `cafe_memberships.medical_claim_balance`
  NUMERIC(10,2) DEFAULT 0; `medical_claims` table (amount_claimed, amount_approved ≤ claimed,
  status pending/approved/rejected with a consistency CHECK, receipt_url, decision fields);
  `touch_updated_at` + `log_claim_change` audit triggers. Reversible with DROP TABLE / DROP COLUMN.

### Behaviour
- Submit reserves nothing; over-submit check = balance − pending, under FOR UPDATE on the membership.
- Approve re-checks balance under lock (cap may have changed), deducts `amount_approved`.
- Reject / cancel-pending: no balance change. Owner purge of an approved claim refunds `amount_approved`.
- Owner's own claim auto-approves. Managers read the queue only.
- Receipts: same 5 MB / type gate as MCs, prefix `claim-receipts/`, served only via `/api/claims/[id]/receipt`.
- Telegram: owners on submit, claimant on decision; all dynamic text HTML-escaped.

### Verification
`npm test` (new harness: storage URL rules, money parsing, claim serialiser, SQL-level tests on a
throwaway local Postgres incl. two-connection concurrency), `tsc`, `eslint --quiet`, `next build`,
and the 10-step browser walk in PR #<n2> against a non-production database.
```

- [ ] **Step 5: `verify-done`**

Invoke the `verify-done` skill and include its evidence + risk-tier statement in the PR body. Risk tier is at least **medium**: merge = production deploy, and this touches money balances.

- [ ] **Step 6: Push and open PR 2**

Confirm the branch with Nyan, then:

```bash
git push -u origin feat/medical-claims
gh pr create --title "feat: medical claims with per-employee cap and owner approval" --body "<summary, schema note, verification walk results, verify-done evidence, risk tier>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**STOP.** Nyan reviews and merges. After merge: one real claim end to end in production, then the CHANGELOG PR numbers are filled in (they are placeholders until both PRs exist).

---

## Self-review

**Spec coverage.** §1 decisions → Tasks 8/9 (deduction on approval, owner-only PATCH, adjustable amount, owner auto-approve, cancel/purge rules, date/amount limits), Task 12/13 (entry points), Task 14 (cap editor), Task 3 (schema). §2 money handling → Task 5 + `toFixed(2)` params in 8/9. §3 storage refactor → Tasks 1–2. §4 API incl. existing-route touches → Tasks 6–9. Notifications → Task 7. §5 UI → Tasks 11–14 (`PendingApprovalsWidget` untouched as spec says). §6 error handling → 8/9 (`FOR UPDATE`, 409, balance re-check). §7 verification → Tasks 10 and 15. §8 sequencing → Task 4 STOP, Task 15 Step 1.

**Placeholders.** CHANGELOG `#<n1>/#<n2>` are explicitly PR numbers unknown until PRs exist — filled at Task 15 Step 6.

**Type consistency.** `medical_claim_balance` is `string` in every DB row type (`Employment`, `ProfileRow`, `JoinedClaimRow.profile_claim_balance`) and `number` in every API/UI type (`SessionUser`, `User`, `ClaimProfile`). Money params to SQL are always `.toFixed(2)` strings with `::numeric`. `RequestConflictError` lives in `lib/claims.ts` and is imported by `[id]/route.ts` only. `serialiseClaim`, `CLAIM_COLUMNS`, `CLAIM_RETURNING`, `CLAIM_PROFILE_COLUMNS` names match between Tasks 7, 8, 9. `handleAttachmentUpload(kind, req)` matches Tasks 2 and 7. `streamGatedAttachment(url, logId)` matches Tasks 1, 2, 9.
