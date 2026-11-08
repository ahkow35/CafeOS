# CafeOS

A web app for running a café team: leave requests, medical claims, timesheets
and daily tasks. One installation serves many cafés, each kept separate.

## Warning: previews share the production database

Vercel preview deployments (the temporary URLs created for each pull request)
use the same database as production. Never create, edit or delete data on a
preview URL while testing.

## What it does

- **Leave**: staff apply for leave; a manager reviews it, then the owner gives
  final approval (`pending_manager`, `pending_owner`, `approved`, `rejected`).
  Medical certificates can be attached.
- **Medical claims**: staff submit receipts with an amount; the owner approves
  or rejects. Approval deducts from a yearly cap set per employee.
- **Timesheets**: staff record hours; managers and owners review them and can
  export to Excel.
- **Tasks**: managers assign tasks; staff mark them complete.
- **Super admin**: platform operators manage cafés and super admins under
  `/super`.
- **Billing**: each café has a Stripe subscription; a café whose subscription
  is cancelled or unpaid is suspended.
- **Notifications**: sent through a Telegram bot (leave, timesheet and claim
  updates, new café sign-ups, payment problems, PIN-reset codes).

## How it works

### Cafés, memberships and roles

One phone number is one account (`profiles`). An account can belong to several
cafés through `cafe_memberships`, with a separate role in each: `staff`,
`manager`, `owner` or `part_timer`. Café pages live under `/c/<slug>/`. A
separate `is_super_admin` flag on the account marks platform operators.
Managers and owners can open `/c/<slug>/admin`. New cafés request access at
`/start` and begin in the `pending` state; cafés can be `pending`, `active` or
`suspended`.

### Sign-in

Staff sign in with a phone number and a PIN (stored as a bcrypt hash). After
five wrong attempts the account locks for 15 minutes. A successful sign-in sets
an HTTP-only cookie, `cafeos_session`, holding a signed JWT that lasts seven
days. `src/middleware.ts` checks it on every request and enforces the café and
role rules. A forgotten PIN is reset with a code sent over Telegram.

Code: `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/pinReset.ts`.

### Database

Neon Postgres, reached through `@vercel/postgres` (`src/lib/db.ts`). There is
no row-level security; access rules are enforced in the application code, and
tenant writes go through `withTenantTx`, which also tags audit-log rows with
who made the change.

- `db/schema.sql`: the full current schema, for a fresh database.
- `db/migrations/`: one plain SQL file per change, named by date.
- `db/bootstrap-super-admin.sql`: creates the first super admin (usage is in
  the file header).

### File storage

Medical certificates and claim receipts are uploaded to Vercel Blob
(`src/lib/storage.ts`). Files are served only through authorised app routes,
never by raw blob link.

### Notifications

Telegram only (`src/lib/notifications.ts`, `src/app/api/telegram/webhook`).
Users link their account to the bot from the app. The code does not send email.

### Installing on a phone

The app has a web manifest (`public/manifest.json`, plus a per-café manifest at
`/c/<slug>/manifest.json`), so a browser can offer to add it to the home screen.
There is no service worker, so it does not work offline.

## Tech stack

From `package.json`:

- Next.js 16.1.6 (App Router), React 19.2.3, TypeScript 5
- `@vercel/postgres` (Neon), `@vercel/blob`, `stripe`
- `jose` (JWT), `bcryptjs` (PIN hashing), `exceljs` (timesheet export)
- `lucide-react` icons; plain CSS in `src/app/globals.css`
- Tests: Node's built-in test runner via `tsx`

## Running locally

Use Node 22 (the version CI uses; `package.json` sets no `engines` field).

```bash
npm ci
npm run dev        # http://localhost:3000
```

There is no `.env.local.example` file. The app reads these environment
variables (names only; get the values from the project owner):

| Variable | Used for |
| --- | --- |
| `POSTGRES_URL` | Database connection (`@vercel/postgres`) |
| `JWT_SECRET` | Signing session cookies and PIN-reset codes; at least 32 characters |
| `APP_BASE_URL` | The app's own address, used in links; required in production |
| `TELEGRAM_BOT_TOKEN` | Sending Telegram messages |
| `TELEGRAM_WEBHOOK_SECRET` | Checking that webhook calls come from Telegram |
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_PRICE_ID` | The subscription price new cafés are charged |
| `STRIPE_WEBHOOK_SECRET` | Checking that webhook calls come from Stripe |
| `TEST_DATABASE_URL` | Optional; enables the database tests (see below) |

Vercel Blob also needs its own access token, which the `@vercel/blob` library
reads itself.

Pointing a local copy at the production database means local writes change real
data. Use a separate throwaway database for development.

## Checks and tests

```bash
npx tsc --noEmit
npm run lint
npm test
```

The tests in `tests/db/` need a throwaway Postgres set in `TEST_DATABASE_URL`
and skip themselves without it. Never point it at production.

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npx next typegen`, typecheck,
lint and `npm test` on Node 22 for every ready (non-draft) pull request, plus a
second job that runs the migration runner tests against a throwaway Postgres
container.

## Database migrations

Migrations are plain SQL files in `db/migrations/`, named `YYYY-MM-DD-<what>.sql`.
`db/schema.sql` is the full current schema for a fresh database; keep it in sync
by hand when a migration changes the schema.

**Merging a pull request to `main` applies its new migrations to production.**
Nobody runs `psql` against the live database by hand any more, and you must
never apply a migration by hand before merging: the runner would then try to
apply it again. The workflow `.github/workflows/migrate.yml` ("Migrate
production database") runs on every push to `main`, and from the Actions tab
with "Run workflow" (that button is the manual re-run). It does not deploy:
Vercel auto-deploy stays on, and a Vercel Deployment Check (setup step 3 below)
holds each production deployment until this job has passed on its commit.

How the runner (`scripts/migrate_prod.sh`) works:

1. It connects with the `PROD_DB_URL` secret, lists the top-level
   `db/migrations/*.sql` files in name order, and skips every file that has a row
   in the ledger table `public.schema_migrations`.
2. Before anything runs, every new file goes through a simple lint (see the
   rules below). One failure refuses the whole run.
3. Each new file then runs, unchanged and from its own path, in ONE transaction:
   an advisory lock (two runners cannot overlap), `lock_timeout` 5s,
   `statement_timeout` 5min, a temp table, the file, a read of that temp table,
   the ledger row, `commit`. A file and its ledger row land together or not at
   all, and any error rolls everything back. There is no dry run and the runner
   never edits a file. The temp table is a tripwire: a file that commits early
   drops it, the read fails, and the run fails with
   `FAILED: <file> (rolled back; stopping). If the error mentions _migrate_guard,
   the file committed early: check production.`
4. The first failure stops everything: no later file runs and the check fails, so
   Vercel leaves the new build unpromoted and the live site keeps the last good
   version. Fix forward with a new migration, then merge again.
5. A run with nothing to apply succeeds, so every commit on `main` passes the
   check (the workflow has no path filter on purpose). GitHub keeps one pending
   run per queue, so a pending run can be replaced by a newer one; that commit's
   deployment is then never promoted, and the newer run applies all pending files.
6. **Empty-ledger guard:** if the ledger has no rows, files are pending, and
   `public` already has any table besides `schema_migrations`, the runner refuses
   before running anything (the seed was forgotten and it would re-run every
   migration). `ALLOW_EMPTY_LEDGER=1` overrides it, for a brand-new database only.

The job prints file names and counts only; the secret is never echoed. The
script takes no arguments. Its tests are `tests/migrate-prod-script.test.ts`
(real Postgres; they skip without `TEST_DATABASE_URL`, and run in CI's
"Migration runner (real Postgres)" job against a throwaway container).

**Rules for every migration file**

- **Make it additive.** The new build waits for the migration (the Deployment
  Check), but the old code still runs briefly against the new schema, so a
  migration must not break it. Also, **previews use the production database**: a
  preview of an unmerged pull request runs the new code against the schema that is
  not yet migrated, so a preview can break on a missing column until the pull
  request merges. Add columns and tables; drop or rename only in a later pull
  request, once no running code uses them.
- **Same-day files run in alphabetical order of the part after the date.** Name
  them so that order is the one you need: `2026-12-01-a-add-table.sql` runs
  before `2026-12-01-b-backfill.sql`, but `2026-12-01-backfill.sql` runs before
  `2026-12-01-orders.sql`.
- **It must be safe to run unattended.** No psql variables or other backslash
  commands, no `SET` of `app.*` parameters needed from the command line, no
  manual gate, no "apply this by hand first" step. File names use only letters,
  digits, dot, dash and underscore.
- **The runner supplies the transaction; a file must not carry its own.** No
  `begin;`, `commit;`, `rollback`, `abort`, `end`, `savepoint`, `release`, `start
  transaction` or `prepare transaction`. The lint refuses (before applying
  anything, with `refusing <file>: transaction control or psql meta-command`) any
  new file with a line that starts with `begin;` or `commit;` (also with
  `work`/`transaction`), `rollback`, `abort`, `savepoint`, `release`, `start
  transaction` or `prepare transaction`, a line that starts with a backslash, or
  a `;` followed by a backslash. **The lint is not a parser:** it ignores quotes,
  comments and dollar-quoting, it does not look for `end` (plpgsql bodies have
  `end;` lines), and a commit placed after other SQL on the same line gets past
  it. Pull request review is the backstop, and so is the temp-table tripwire
  above (a missed early commit fails the run and keeps the deploy unpromoted, but
  the file may already be live: check production).
- **The 12 files that existed before the runner** all carry their own
  `begin;`/`commit;` lines, so the lint would refuse them. They were applied by
  hand and go in the ledger seed below; the runner never reaches them.

**One-time setup (Nyan, before merging the pull request that added the runner;
that pull request does none of it)**

1. *Set the secret.* In the GitHub repository, Settings, Secrets and variables,
   Actions, add `PROD_DB_URL`: the **direct (unpooled)** Neon connection string,
   the value of Vercel's `POSTGRES_URL_NON_POOLING` (the host has no `-pooler`).
   The runner takes an advisory lock and runs a transaction, which a pooled
   connection does not guarantee. Without the secret the job fails with a
   message saying so.
2. *Seed the ledger.* The ledger table does not exist in production yet and the
   runner would create it empty, so without a seed it would try to re-apply every
   migration (the empty-ledger guard and the lint would stop it, but do not rely
   on that). Run this once against production, from the Neon SQL editor or
   `psql`. It lists every file already applied by hand: the 12 on `main` plus
   `2026-09-24-instant-signup.sql` from draft pull request #16, which was already
   applied to production by hand. List only files really applied: a file marked
   applied but not is skipped for ever; a file applied but not marked is run
   again. Leave the ledger file `2026-11-09-schema-migrations.sql` out: it is safe
   to run twice. Template (nobody has run it yet):

   ```sql
   create table if not exists public.schema_migrations (
     filename   text primary key,
     applied_at timestamptz not null default now()
   );
   alter table public.schema_migrations enable row level security;

   insert into public.schema_migrations (filename) values
     ('2026-05-04-drop-profile-role.sql'),
     ('2026-05-04-multitenant-additive.sql'),
     ('2026-05-04-tripwire-triggers.sql'),
     ('2026-05-09-billing.sql'),
     ('2026-06-06-timesheet-unique-per-cafe.sql'),
     ('2026-07-13-employment-to-membership.sql'),
     ('2026-07-13-telegram-link-codes.sql'),
     ('2026-07-14-task-completions.sql'),
     ('2026-08-06-pin-reset-tokens.sql'),
     ('2026-09-03-leave-audit-insert-delete.sql'),
     ('2026-09-03-medical-claims.sql'),
     ('2026-09-23-suspend-and-pin-provenance.sql'),
     ('2026-09-24-instant-signup.sql')
   on conflict do nothing;

   select count(*) from public.schema_migrations;  -- expect 13
   ```

   If draft pull request #16 is not merged yet, its name in the seed is harmless:
   the runner cannot see that file, and when #16 merges the file is already in
   the ledger.
3. *Add the Deployment Check in Vercel.* Leave production auto-deploy ON. After
   the first green run of this workflow on `main`, in the Vercel project:
   Settings, Build and Deployment, Deployment Checks, Add Checks, GitHub,
   `Migrate production database`. Prerequisite: automatic production domain
   assignment is on. From then on each production deployment waits for that check
   on its commit. *Force Promote* in Vercel bypasses the check: use it only when
   the schema does not matter for that build.

## Deployment

Hosted on Vercel. Every merge to `main` deploys to production automatically;
every pull request gets a preview deployment (see the warning at the top).
`/api/ping` is an unauthenticated health check.

## Project structure

```
src/
  app/
    c/[slug]/      Café pages: leave, claims, tasks, timesheet, billing,
                   account, admin/
    super/         Platform admin: cafés and super admins
    login/         Sign-in and PIN reset
    start/         Request a new café
    api/           Route handlers (auth, leave-requests, claims, timesheets,
                   tasks, uploads, billing, telegram, webhooks, super, ...)
  components/      Shared React components
  context/         Auth and toast React contexts
  lib/             Database, auth, storage, billing, notifications, helpers
  middleware.ts    Session and role checks
db/                schema.sql, migrations/, bootstrap-super-admin.sql
tests/             Unit tests; tests/db/ needs TEST_DATABASE_URL
scripts/           migrate_prod.sh (the migration runner), one-off scripts
public/            Icons and the web manifest
docs/              Design notes and plans
.github/workflows/ CI and the production migration runner
```

`CHANGELOG.md` records what changed and when.

## License

Private and proprietary. Contact the owner for licensing information.
