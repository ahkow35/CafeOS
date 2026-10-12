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
lint and `npm test` on Node 22 for every pull request and every push to `main`.

## Database migrations

Migrations are plain SQL files in `db/migrations/`. There is no migration tool:
a person applies each file to the database by hand (for example with `psql`),
and also keeps `db/schema.sql` up to date.

**Order matters.** Merging to `main` deploys to production automatically. If
the new code needs a schema change, apply the migration to the production
database first, then merge. Merging first would put code live that queries
columns or tables that do not exist yet. Make migrations additive so the old
code keeps working until the new code lands.

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
scripts/           One-off scripts (backfill-phones.ts)
public/            Icons and the web manifest
docs/              Design notes and plans
.github/workflows/ CI
```

`CHANGELOG.md` records what changed and when.

## License

Private and proprietary. Contact the owner for licensing information.
