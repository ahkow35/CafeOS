-- db/migrations/2026-11-09-schema-migrations.sql
--
-- The migration ledger. One row per migration file that has been applied to this database.
-- scripts/migrate_prod.sh, run by .github/workflows/migrate.yml when a pull request merges to
-- main, applies every top-level db/migrations/*.sql file that has no row here, then records it,
-- in the same transaction as the file itself.
--
-- The runner creates this table itself on its first run (the same statements as below, so
-- running both is harmless). Before that first run, the filename of every migration already
-- applied by hand is inserted (README, "Database migrations", one-time setup).
-- Private table: row-level security on, no policy. No revoke: Neon has no anon/authenticated
-- roles. The app's own role owns the table and is not blocked by row-level security.
-- Rollback: DROP TABLE public.schema_migrations; (the next merge would then see an empty
-- ledger and the runner would refuse, so only do this together with removing the workflow.)

create table if not exists public.schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);

alter table public.schema_migrations enable row level security;
