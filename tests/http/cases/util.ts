/** Small helpers shared by the case modules. */
import assert from 'node:assert/strict';
import { row, type Json, type Reply } from '../harness';
import { pinRefusal } from './pins';

export const SIG = 'data:image/png;base64,AAAA';

/** A table cell: an HTTP status that refuses, or 'ok:<new status>' for a move that is allowed. */
export type Cell = number | `ok:${string}`;

export function expectStatus(r: Reply, http: number): void {
  assert.equal(r.status, http, `expected HTTP ${http}, got ${r.status}: ${JSON.stringify(r.json)}`);
}

/** A refusal: the status must match and the whole reply is pinned under `key` (see pins.ts). */
export function refuse(key: string, r: Reply, http: number): void {
  expectStatus(r, http);
  pinRefusal(key, r);
}

/** Fetch one row by id, or undefined once it is gone. */
export function byId(table: string, id: string): Promise<Json | undefined> {
  return row(`SELECT * FROM ${table} WHERE id = $1`, [id]);
}

/** Keep only the named columns, so a before/after comparison ignores timestamps we cannot predict. */
export function pick(r: Json | undefined, cols: string[]): Json {
  assert.ok(r, 'row should exist');
  return Object.fromEntries(cols.map((c) => [c, r[c]]));
}

/** Expect the id (or null) in a stamp column, without ever comparing a clock value. */
export function stampIs(r: Json | undefined, col: string, expected: string | null): void {
  assert.equal(r?.[col] ?? null, expected, `${col} should be ${expected === null ? 'empty' : 'the actor'}`);
}
