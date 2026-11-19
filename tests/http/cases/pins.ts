/**
 * Golden file for refusals: every reply with an HTTP status of 400 or more that a case module
 * triggers is compared (status and whole body) with tests/http/snapshots/refusals.json, under a
 * unique, readable key. UPDATE_HTTP_SNAPSHOTS=1 records the file instead of comparing; it is never
 * recorded by default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Reply } from '../harness';

const FILE = path.join(__dirname, '..', 'snapshots', 'refusals.json');
const RECORD = process.env.UPDATE_HTTP_SNAPSHOTS === '1';

type Pinned = { status: number; body: unknown };

const golden: Record<string, Pinned> = RECORD || !fs.existsSync(FILE) ? {} : JSON.parse(fs.readFileSync(FILE, 'utf8'));
const seen = new Map<string, Pinned>();

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Narrow rules for values that differ between runs or machines; everything else is compared as is.
 * 1. A generated id in the `id` key of a body becomes '<generated id>'.
 * 2. The message 'entry_date must be within YYYY-MM' (the month comes from a per-run counter) becomes
 *    'entry_date must be within <year-month>'.
 * 3. In the message that starts 'Overlaps with existing', each date printed by the server (its text depends
 *    on the counter year and the host time zone) becomes '<date>'.
 */
const DATE_TEXT = /[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4} \([^)]*\)/g;
function stable(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (typeof out.id === 'string' && out.id.replace(UUID, '') === '') out.id = '<generated id>';
  if (typeof out.error === 'string') {
    out.error = out.error
      .replace(/^(entry_date must be within )\d{4}-\d{2}$/, '$1<year-month>')
      .replace(/^(Overlaps with existing .*)$/, (m) => m.replace(DATE_TEXT, '<date>'));
  }
  return out;
}

/** Pin one refusal: compare (or record) its status and whole reply body under a unique key. */
export function pinRefusal(key: string, r: Reply): void {
  assert.ok(r.status >= 400, `${key}: only a refusal can be pinned, got HTTP ${r.status}`);
  assert.ok(!seen.has(key), `refusal key used twice in one run: ${key}`);
  const got: Pinned = { status: r.status, body: stable(r.json) };
  seen.set(key, got);
  if (RECORD) return;
  assert.ok(key in golden, `refusal not in the golden file (record with UPDATE_HTTP_SNAPSHOTS=1): ${key}`);
  assert.deepStrictEqual(got, golden[key], `reply differs from the golden file for: ${key}`);
}

/** Run once after the whole suite: write the file when recording, otherwise fail on an entry nobody visited. */
export function finishPins(): void {
  if (RECORD) {
    const sorted = Object.fromEntries([...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    fs.writeFileSync(FILE, `${JSON.stringify(sorted, null, 2)}\n`);
    return;
  }
  const unvisited = Object.keys(golden).filter((k) => !seen.has(k));
  assert.deepEqual(unvisited, [], 'golden file holds refusals that no test visited');
}
