#!/usr/bin/env bash
#
# Creates (or recreates) a local `cafeos_dev` Postgres database on Homebrew
# Postgres, loads db/schema.sql, then seeds it with db/seed-dev.sql.
#
# Prereqs (see docs/LOCAL_DEV.md):
#   - Homebrew Postgres installed (psql/createdb/pg_ctl at /opt/homebrew/bin)
#   - The server running. This script does NOT start it — do that yourself:
#       brew services start postgresql@18
#
# NEVER point this at production. This script only ever touches a local
# database named cafeos_dev on localhost — it never reads LOCAL_PG_URL,
# POSTGRES_URL, or any .env file.
set -euo pipefail

PSQL_BIN_DIR="${PSQL_BIN_DIR:-/opt/homebrew/bin}"
DB_NAME="cafeos_dev"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-$(whoami)}"

export PATH="$PSQL_BIN_DIR:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found on PATH or at $PSQL_BIN_DIR." >&2
  echo "Install Homebrew Postgres first: brew install postgresql@18" >&2
  exit 1
fi

if ! pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  echo "Postgres is not accepting connections on $PGHOST:$PGPORT." >&2
  echo "Start it first: brew services start postgresql@18" >&2
  exit 1
fi

echo "Dropping and recreating local database '$DB_NAME' on $PGHOST:$PGPORT..."
dropdb --if-exists --force -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"

echo "Loading schema..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/db/schema.sql" >/dev/null

echo "Loading seed data..."
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/db/seed-dev.sql"

cat <<EOF

Local database ready: $DB_NAME

Set this in .env.development.local (see docs/LOCAL_DEV.md):
  LOCAL_PG_URL=postgres://$PGUSER@$PGHOST:$PGPORT/$DB_NAME

Seeded logins (all PINs are 6 digits):
  Owner (café "demo")         +6580001001  PIN 284915
  Manager (café "demo")       +6580001002  PIN 573062
  Staff (café "demo")         +6580001003  PIN 619427
  Staff (café "demo")         +6580001004  PIN 738254
  Part-timer (café "demo")    +6580001005  PIN 947163
  Part-timer (demo + second)  +6580001006  PIN 385290
  Owner (café "second")       +6580002001  PIN 512973
  Super admin (no café)       +6580009999  PIN 826734

Never point LOCAL_PG_URL at production. This script only ever touches the
local $DB_NAME database.
EOF
