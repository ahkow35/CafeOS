# Local development database

CafeOS talks to Neon (`@vercel/postgres`) in production, which only speaks
Neon's websocket wire protocol — it can't reach a plain local Postgres. For
local dev, screenshots, and end-to-end tests, `src/lib/db.ts` has a dev-only
switch that backs `sql`/`query`/transactions with a plain `pg` connection to a
local database instead, when `LOCAL_PG_URL` is set.

**Never point `LOCAL_PG_URL` at production.** It is a local-only escape hatch;
if `NODE_ENV=production` and `LOCAL_PG_URL` is set, the app throws at startup
rather than risk it.

## 1. Start Postgres

This project uses Homebrew Postgres. Start the service once (not run by any
script here):

```
brew services start postgresql@18
```

## 2. Create and seed the database

```
npm run db:local
```

This drops and recreates a local `cafeos_dev` database, loads
`db/schema.sql`, then seeds it from `db/seed-dev.sql`. It only ever touches
`cafeos_dev` on `localhost` — it never reads `.env.local` or any production
connection string. Re-run it any time you want a clean slate.

The script prints the seeded logins when it finishes (see below).

## 3. Point the app at it

Add to `.env.development.local` (create it if it doesn't exist):

```
LOCAL_PG_URL=postgres://<your-mac-username>@localhost:5432/cafeos_dev
```

`.env.development.local` is only loaded for `next dev`, not `next build` —
use that file rather than `.env.local` so a local production build still
works without having to unset anything. (`.env.local` is loaded in *every*
environment including builds; if you put `LOCAL_PG_URL` there instead, a
local `next build` will refuse to start with the "LOCAL_PG_URL is set with
NODE_ENV=production" error above — that's the guard working, not a bug, but
you'd need to comment the line out before building.)

You also need a `JWT_SECRET` (32+ chars) to sign session cookies — generate
one with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## 4. Run the app

```
npm run dev
```

Log in at `/login` with one of the seeded accounts.

## Seeded logins

All PINs are 6 digits. All phone numbers are fake, in the `+65 8000xxxx`
reserved range.

| Role | Café | Phone | PIN |
|---|---|---|---|
| Owner | demo | +6580001001 | 284915 |
| Manager | demo | +6580001002 | 573062 |
| Staff | demo | +6580001003 | 619427 |
| Staff | demo | +6580001004 | 738254 |
| Part-timer | demo | +6580001005 | 947163 |
| Part-timer | demo **and** second | +6580001006 | 385290 |
| Owner | second | +6580002001 | 512973 |
| Super admin | (none — platform-scope) | +6580009999 | 826734 |

The "demo" café also has sample leave requests (each status), medical claims
(pending + approved), timesheets (submitted / pending_owner / approved), and
tasks (including one assigned to everyone).

## Never do this

- Never set `LOCAL_PG_URL` to a Neon/production connection string.
- Never copy `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` from `.env.local`
  into anything that also has `LOCAL_PG_URL` set — the two are meant to never
  coexist in the same running process.
- Never run `scripts/local-db.sh` against anything but your local machine —
  it does not take a host argument for exactly this reason.
