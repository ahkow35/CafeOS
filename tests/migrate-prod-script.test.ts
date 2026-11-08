/**
 * scripts/migrate_prod.sh (the runner .github/workflows/migrate.yml calls on merge), run against a
 * REAL throwaway Postgres named by TEST_DATABASE_URL. Skipped locally without it; in CI's
 * "Migration runner (real Postgres)" job MIGRATE_REQUIRE_POSTGRES=1 turns a missing URL into a
 * failure. Local host only: the runner is never pointed at anything else here. Each test makes its
 * own empty database on that server and its own temporary migration folder, so the repo's real
 * migrations are never run (except the one ledger file, on purpose) and nothing is shared.
 *
 * What is proved:
 * - new top-level files are applied in name order and recorded; the ledger table is created when
 *   missing;
 * - a second run applies nothing and leaves the ledger as it was;
 * - a failing file stops the run: no ledger row for it, nothing of it left behind, and no later
 *   file is applied;
 * - subfolders are never run; any argument is a usage error (there is no dry run);
 * - the lint refuses (before anything is applied) a pending file with a begin/commit statement
 *   line, rollback, abort, savepoint, release, start/prepare transaction, or a psql meta-command,
 *   even one placed after an earlier clean pending file; a plpgsql body with begin/end is fine;
 * - a file that commits early in a form the lint misses fails at the temp-table tripwire and gets
 *   no ledger row;
 * - an empty ledger over a database that already has tables is refused unless ALLOW_EMPTY_LEDGER=1;
 *   a seeded ledger skips the seeded files;
 * - a bad file name is refused; a missing or unreachable URL fails cleanly;
 * - the URL is never printed;
 * - the repo's own ledger migration applies cleanly and matches what the runner creates.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const url = process.env.TEST_DATABASE_URL ?? '';
if (!url && process.env.MIGRATE_REQUIRE_POSTGRES === '1') {
  throw new Error('MIGRATE_REQUIRE_POSTGRES=1 but TEST_DATABASE_URL is not set');
}
const skip = url ? false : 'TEST_DATABASE_URL not set: real Postgres not available';

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'migrate_prod.sh');
const REPO_MIGRATIONS = path.resolve(__dirname, '..', 'db', 'migrations');

function localOnly(u: string) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(u).hostname), 'local throwaway database only');
}

function withDb(u: string, name: string) {
  const parts = new URL(u);
  parts.pathname = '/' + name;
  return parts.toString();
}

function psql(u: string, text: string): string {
  localOnly(u);
  const done = spawnSync('psql', [u, '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 60_000 });
  assert.equal(done.status, 0, done.stderr);
  return done.stdout.trim();
}

let dbName = '';
let dbUrl = '';
let folder = '';

function write(name: string, sql: string, dir = folder) {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(sql)); // bytes: keeps a CRLF as written
}

function run(opts: { url?: string | null; args?: string[]; env?: Record<string, string> } = {}) {
  const u = opts.url === undefined ? dbUrl : opts.url;
  if (u) localOnly(u);
  const env: NodeJS.ProcessEnv = { ...process.env, MIGRATIONS_DIR: folder, ...opts.env };
  delete env.PROD_DB_URL;
  if (u) env.PROD_DB_URL = u;
  const done = spawnSync(SCRIPT, opts.args ?? [], { env, encoding: 'utf8', timeout: 120_000 });
  // The URL (and so its password) must never reach the output, success or failure.
  if (u) assert.ok(!(done.stdout + done.stderr).includes(u), 'the connection URL leaked into the output');
  return done;
}

const ledger = () => psql(dbUrl, 'select filename from public.schema_migrations order by filename').split('\n').filter(Boolean);
const hasTable = (t: string) => psql(dbUrl, `select to_regclass('public.${t}') is not null`) === 't';

describe('scripts/migrate_prod.sh', { skip }, () => {
  beforeEach(() => {
    dbName = 'migrate_test_' + randomBytes(6).toString('hex');
    psql(url, `create database ${dbName}`);
    dbUrl = withDb(url, dbName);
    folder = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'migrations-'));
  });
  afterEach(() => {
    psql(url, `drop database if exists ${dbName} with (force)`);
    rmSync(folder, { recursive: true, force: true });
  });

  test('applies new files in order and records them', () => {
    write('2026-01-01-a.sql', 'create table t_a (id int);\n');
    write('2026-01-02-b.sql', 'create table t_b (id int);\ninsert into t_b values (1);\n');
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.ok(done.stdout.indexOf('applied: 2026-01-01-a.sql') < done.stdout.indexOf('applied: 2026-01-02-b.sql'));
    assert.match(done.stdout, /applied 2 of 2 new migrations/);
    assert.ok(hasTable('t_a') && hasTable('t_b'));
    assert.deepEqual(ledger(), ['2026-01-01-a.sql', '2026-01-02-b.sql']);
  });

  test('same-day files run in alphabetical order of the part after the date', () => {
    write('2026-01-01-b-second.sql', 'insert into t_a values (2);\n');
    write('2026-01-01-a-first.sql', 'create table t_a (id int);\ninsert into t_a values (1);\n');
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(ledger(), ['2026-01-01-a-first.sql', '2026-01-01-b-second.sql']);
    assert.equal(psql(dbUrl, 'select count(*) from t_a'), '2'); // b would fail first if it ran before a
  });

  test('a second run applies nothing', () => {
    write('2026-01-01-a.sql', 'create table t_a (id int);\n');
    assert.equal(run().status, 0);
    const first = psql(dbUrl, 'select filename, applied_at from public.schema_migrations');
    // It would fail (the table exists) if the file were applied twice.
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /1 on disk, 1 already applied, 0 new/);
    assert.match(done.stdout, /nothing to apply/);
    assert.equal(psql(dbUrl, 'select filename, applied_at from public.schema_migrations'), first);
  });

  test('a failing file stops the run, leaves no ledger row and runs nothing after it', () => {
    write('2026-01-01-ok.sql', 'create table t_ok (id int);\n');
    write('2026-01-02-bad.sql', 'create table t_bad (id int);\nselect 1/0;\n');
    write('2026-01-03-after.sql', 'create table t_after (id int);\n');
    const done = run();
    assert.equal(done.status, 1);
    assert.match(done.stderr, /FAILED: 2026-01-02-bad\.sql/);
    assert.ok(hasTable('t_ok'));
    assert.ok(!hasTable('t_bad'), 'the failed file must be rolled back whole');
    assert.ok(!hasTable('t_after'));
    assert.deepEqual(ledger(), ['2026-01-01-ok.sql']);
  });

  test('each file runs with lock_timeout 5s and statement_timeout 5min', () => {
    write('2026-01-01-a.sql', "create table t_a as select current_setting('lock_timeout') as lt, current_setting('statement_timeout') as st;\n");
    assert.equal(run().status, 0);
    assert.equal(psql(dbUrl, "select lt || '/' || st from t_a"), '5s/5min');
  });

  test('subfolders are never run', () => {
    write('2026-01-01-a.sql', 'create table t_a (id int);\n');
    write('down/2026-01-01-a.sql', 'create table t_down (id int);\n');
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.ok(hasTable('t_a') && !hasTable('t_down'));
    assert.deepEqual(ledger(), ['2026-01-01-a.sql']);
  });

  test('any argument is a usage error', () => {
    write('2026-01-01-a.sql', 'create table t_a (id int);\n');
    for (const arg of ['--dry-run', 'x']) {
      const done = run({ args: [arg] });
      assert.equal(done.status, 2);
      assert.match(done.stderr, /usage/);
    }
    assert.ok(!hasTable('t_a') && !hasTable('schema_migrations'));
  });

  test('a missing URL or an unreachable database fails cleanly', () => {
    const missing = run({ url: null });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /PROD_DB_URL is not set/);
    const parts = new URL(dbUrl);
    parts.port = '1';
    const dead = run({ url: parts.toString() });
    assert.notEqual(dead.status, 0);
    assert.match(dead.stderr, /cannot connect/);
  });

  test('a file name outside the plain pattern is refused before anything runs', () => {
    write('2026-01-01-ok.sql', 'create table t_ok (id int);\n');
    write("2026-01-02-it's.sql", 'create table t_q (id int);\n');
    const done = run();
    assert.equal(done.status, 1);
    assert.match(done.stderr, /refusing file name/);
    assert.ok(!hasTable('t_ok') && !hasTable('t_q'));
  });

  test('function bodies with begin and end lines apply', () => {
    // plpgsql bodies have lines that start with begin and end;: the lint must not refuse them.
    write(
      '2026-01-01-f.sql',
      'create function f() returns int language plpgsql as $$\r\nbegin\r\n  return 1;\r\nend;\r\n$$;\r\n' +
        'create function g() returns int language plpgsql as $body$\nbegin\nreturn 2;\nend;\n$body$;\n' +
        'create table t_f as select f() as v, case when true then 1 end as w;\n',
    );
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.equal(psql(dbUrl, 'select v from t_f'), '1');
    assert.deepEqual(ledger(), ['2026-01-01-f.sql']);
  });

  test('an empty ledger over existing tables is refused unless ALLOW_EMPTY_LEDGER=1', () => {
    psql(dbUrl, 'create table already_here (id int)');
    write('2026-01-01-a.sql', 'create table t_a (id int);\n');
    const refused = run();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /ledger is empty but the database already has tables/);
    assert.ok(!hasTable('t_a'));
    assert.ok(!hasTable('schema_migrations') || ledger().length === 0);
    // The override is for a brand-new database; here it just proves the guard is the only blocker.
    const done = run({ env: { ALLOW_EMPTY_LEDGER: '1' } });
    assert.equal(done.status, 0, done.stderr);
    assert.ok(hasTable('t_a'));
    assert.deepEqual(ledger(), ['2026-01-01-a.sql']);
  });

  test('a seeded ledger skips the seeded files even over existing tables', () => {
    psql(
      dbUrl,
      "create table already_here (id int); create table public.schema_migrations (filename text primary key, applied_at timestamptz not null default now()); insert into public.schema_migrations (filename) values ('2026-01-01-old.sql');",
    );
    write('2026-01-01-old.sql', 'create table already_here (id int);\n'); // would fail if it ran
    write('2026-01-02-new.sql', 'create table t_new (id int);\n');
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /2 on disk, 1 already applied, 1 new/);
    assert.deepEqual(ledger(), ['2026-01-01-old.sql', '2026-01-02-new.sql']);
  });

  const lintCases: Array<[string, string]> = [
    ['begin;', 'create table t_x (id int);\nbegin;\n'],
    ['commit; indented, mixed case', 'create table t_x (id int);\n  Commit;\n'],
    ['commit work; CRLF', 'create table t_x (id int);\r\ncommit work;\r\n'],
    ['commit transaction ;', 'create table t_x (id int);\nCOMMIT TRANSACTION ;\n'],
    ['rollback', 'create table t_x (id int);\nrollback;\n'],
    ['abort', 'create table t_x (id int);\nabort;\n'],
    ['savepoint', 'create table t_x (id int);\nsavepoint s;\n'],
    ['release', 'create table t_x (id int);\nrelease s;\n'],
    ['start transaction', 'create table t_x (id int);\nstart transaction;\n'],
    ['prepare transaction', "create table t_x (id int);\nprepare transaction 'x';\n"],
    ['backslash line', '\\set x 1\ncreate table t_x (id int);\n'],
    ['indented backslash line', 'create table t_x (id int);\n   \\q\n'],
    ['; then backslash', 'create table t_x (id int);\nselect 1; \\q\n'],
    ['; then backslash, first line', 'select 1;\\q\ncreate table t_x (id int);\n'],
  ];
  for (const [label, body] of lintCases) {
    test(`lint refuses ${label} and nothing is applied`, () => {
      write('2026-01-01-ok.sql', 'create table t_ok (id int);\n'); // clean and earlier: must not run either
      write('2026-01-02-x.sql', body);
      const done = run();
      assert.equal(done.status, 1);
      assert.match(done.stderr, /refusing 2026-01-02-x\.sql: transaction control or psql meta-command/);
      assert.ok(!hasTable('t_ok') && !hasTable('t_x'));
      assert.deepEqual(ledger(), []);
    });
  }

  test('an early commit the lint misses fails at the tripwire', () => {
    // The lint looks at line starts, so a commit after other SQL on the same line gets through.
    // The commit then drops the temp table, the read of it fails, and no ledger row is written.
    // (t_leak itself is already committed: that is what the failure message tells a person to check.)
    write('2026-01-01-leaky.sql', 'create table t_leak (id int); COMMIT/**/WORK;\nselect 1;\n');
    write('2026-01-02-after.sql', 'create table t_after (id int);\n');
    const done = run();
    assert.equal(done.status, 1);
    assert.match(done.stderr, /FAILED: 2026-01-01-leaky\.sql/);
    assert.match(done.stderr, /_migrate_guard/);
    assert.deepEqual(ledger(), []);
    assert.ok(!hasTable('t_after'));
  });

  test('the repo ledger migration passes the lint and is a no-op over the runner-made table', () => {
    const name = '2026-11-09-schema-migrations.sql';
    write(name, readFileSync(path.join(REPO_MIGRATIONS, name), 'utf8'));
    const done = run();
    assert.equal(done.status, 0, done.stderr);
    assert.deepEqual(ledger(), [name]);
    assert.equal(psql(dbUrl, "select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass"), 't');
    assert.equal(psql(dbUrl, "select count(*) from pg_policies where tablename = 'schema_migrations'"), '0');
  });

  test('every real migration file has a plain name the runner accepts', () => {
    // The runner refuses odd names on the first merge that adds one: catch it in the PR instead.
    for (const name of readdirSync(REPO_MIGRATIONS)) {
      assert.match(name, /^[A-Za-z0-9._-]+\.sql$/, name);
    }
  });
});
