/**
 * Guard: the cafe-access rule is written once, in src/lib/cafeAccess.ts. A new hand-written
 * copy of the membership-status condition elsewhere under src/ fails this test; call
 * lookupCafeAccess / listAccessChatIds instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..', 'src');
const HOME = 'src/lib/cafeAccess.ts';

// Files that still contain the condition today, each with the reason.
const ALLOWED: Record<string, string> = {
  'src/app/api/telegram/webhook/route.ts': 'waits for the open change to that route',
  'src/app/api/admin/users/route.ts': 'listing: shows people whose access is off on purpose',
  'src/app/api/admin/users/[id]/route.ts': 'listing: shows people whose access is off on purpose',
  'src/app/api/admin/stats/route.ts': 'listing: counts people whose access is off on purpose',
  'src/app/api/super/cafes/route.ts': 'listing: counts members for the super-admin cafe list',
  'src/app/api/profiles/route.ts': 'listing: already filters on employment_active itself',
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

const COPY = /m\.status\s*=\s*'active'/;

test('the membership-status condition is only written in cafeAccess.ts and the allowlist', () => {
  const found = walk(SRC)
    .map((f) => path.relative(path.resolve(SRC, '..'), f).split(path.sep).join('/'))
    .filter((rel) => COPY.test(readFileSync(path.join(SRC, '..', rel), 'utf8')));
  const unexpected = found.filter((f) => f !== HOME && !(f in ALLOWED));
  assert.deepEqual(unexpected, [], `hand-written copy of the cafe-access rule; use src/lib/cafeAccess.ts: ${unexpected.join(', ')}`);
});

test('every allowlisted file still contains the condition (remove entries as files move over)', () => {
  const stale = Object.keys(ALLOWED).filter((rel) => !COPY.test(readFileSync(path.join(SRC, '..', rel), 'utf8')));
  assert.deepEqual(stale, [], `allowlist entries without the condition: ${stale.join(', ')}`);
});
