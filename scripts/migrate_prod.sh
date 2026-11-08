#!/usr/bin/env bash
# Apply the migrations that production has not seen yet. Run by .github/workflows/migrate.yml
# on every push to main; it can also be run by hand.
#
#   PROD_DB_URL=postgres://... scripts/migrate_prod.sh
#
# What it does:
#   1. connects (select 1) and makes sure public.schema_migrations exists (see
#      db/migrations/2026-11-09-schema-migrations.sql);
#   2. lists the TOP-LEVEL db/migrations/*.sql files in name order and keeps the ones with no row
#      in the ledger;
#   3. lints every pending file (below) and refuses the whole run, before applying anything, if
#      one fails;
#   4. runs each pending file, from its own path and unchanged, in ONE transaction: advisory
#      lock (two runners cannot overlap), lock_timeout 5s, statement_timeout 5min, a temp table
#      dropped on commit, the file, a read of that temp table, the ledger row, commit. A file and
#      its ledger row land together or not at all, and any error rolls everything back;
#   5. stops at the first failure: no later file runs, and the exit status is non-zero.
# The file text is never rewritten and there is no dry run: a dry run cannot be made safe against
# a file that commits, and one transaction already rolls back on error.
#
# The lint is refuse-only. It catches honest mistakes (a line that starts with begin;, commit;,
# rollback, abort, savepoint, release, start transaction, prepare transaction, a line that starts
# with a backslash, or a ; followed by a backslash). It is NOT a parser: it does not understand
# quotes, comments or dollar-quoting, and it does not look for END (plpgsql bodies have end;
# lines). PR review is the backstop, and so is the temp table: a file that commits early by any
# form the lint misses makes the read of that table fail, the run fails loudly, and the Deployment
# Check stays red (the file may then be live: check production).
#
# Files already applied by hand before this runner existed go into the ledger seed (README,
# "Database migrations"), so the runner never reaches them.
#
# An empty ledger over a database that already has tables is refused (the seed was forgotten:
# every migration would be re-run); ALLOW_EMPTY_LEDGER=1 overrides it for a brand-new database.
#
# Secrets: the URL is read from PROD_DB_URL, handed only to psql, and never printed. No set -x.
# Output is filenames and counts only, plus psql's own error text when a file fails.
# MIGRATIONS_DIR overrides the folder (tests use it with a throwaway database).
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "usage: scripts/migrate_prod.sh (no arguments; see the header for the environment)" >&2
  exit 2
fi

if [ -z "${PROD_DB_URL:-}" ]; then
  echo "PROD_DB_URL is not set" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
dir="${MIGRATIONS_DIR:-$here/../db/migrations}"
[ -d "$dir" ] || { echo "migration folder not found: $dir" >&2; exit 1; }

db_url="$PROD_DB_URL"
unset PROD_DB_URL
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$db_url" "$@"; }
lock_key=7355608221114          # one constant: every runner takes the same advisory lock

work="$(mktemp -d "${TMPDIR:-/tmp}/migrate.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if ! psql_q -At -c 'select 1' >/dev/null 2>&1; then
  echo "cannot connect to the database (check the connection secret)" >&2
  exit 1
fi

# The same statements as db/migrations/2026-11-09-schema-migrations.sql; safe to repeat.
psql_q -c "
  create table if not exists public.schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
  );
  alter table public.schema_migrations enable row level security;" >/dev/null
psql_q -At -c 'select filename from public.schema_migrations' > "$work/applied"

# Name order, top level only. A name must be plain so it can sit inside SQL quotes.
export LC_ALL=C
pending=()
total=0
for f in "$dir"/*.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  if [[ ! "$name" =~ ^[A-Za-z0-9._-]+\.sql$ ]]; then
    echo "refusing file name: $name (letters, digits, dot, dash and underscore only)" >&2
    exit 1
  fi
  total=$((total + 1))
  grep -Fxq -- "$name" "$work/applied" || pending+=("$name")
done
echo "migrations: $total on disk, $((total - ${#pending[@]})) already applied, ${#pending[@]} new"

if [ "${#pending[@]}" = 0 ]; then
  echo "nothing to apply"
  exit 0
fi

# An empty ledger over a database that already has tables means the seed was forgotten.
if [ ! -s "$work/applied" ] && [ "${ALLOW_EMPTY_LEDGER:-}" != 1 ]; then
  existing="$(psql_q -At -c "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")"
  if [ "$existing" != 0 ]; then
    echo "ledger is empty but the database already has tables: seed public.schema_migrations first (README, "Database migrations") or set ALLOW_EMPTY_LEDGER=1 for a brand-new database" >&2
    exit 1
  fi
fi

# The lint (see the header): a line that starts with transaction control, a line that starts with a
# backslash, or a ; followed by a backslash. begin/commit only as a whole statement, because
# plpgsql bodies have lines that start with a bare begin.
sp='[[:space:]]'
lint="^$sp*(((begin|commit)($sp+(work|transaction))?$sp*;)|((rollback|abort|savepoint|release|start$sp+transaction|prepare$sp+transaction)([^a-zA-Z0-9_]|\$))|\\\\)|;$sp*\\\\"
for name in "${pending[@]}"; do
  if grep -Eiq -- "$lint" "$dir/$name"; then
    echo "refusing $name: transaction control or psql meta-command (see the README, "Database migrations")" >&2
    exit 1
  fi
done

applied=0
for name in "${pending[@]}"; do
  if ! psql_q -f - >/dev/null <<SQL
set client_min_messages = warning;
begin;
select pg_advisory_xact_lock($lock_key);
set local lock_timeout = '5s';
set local statement_timeout = '5min';
create temp table _migrate_guard (x int) on commit drop;
\i '$dir/$name'
select 1 from _migrate_guard;
insert into public.schema_migrations (filename) values ('$name');
commit;
SQL
  then
    echo "FAILED: $name (rolled back; stopping). If the error mentions _migrate_guard, the file committed early: check production." >&2
    exit 1
  fi
  applied=$((applied + 1))
  echo "applied: $name"
done
echo "applied $applied of ${#pending[@]} new migrations"
