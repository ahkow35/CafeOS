/**
 * Backfill real phone numbers onto migrated profiles.
 *
 * Input CSV format (header required):
 *   email,phone_e164
 *   alice@cafe.com,+6591234567
 *   bob@cafe.com,+6587654321
 *
 * Lookup strategy:
 *   1. Match `email` in CSV against profiles.email (case-insensitive).
 *   2. UPDATE phone_e164. Skip rows whose phone hasn't changed.
 *
 * Run:
 *   npx tsx scripts/backfill-phones.ts ./real-phones.csv
 *
 * Required env:
 *   POSTGRES_URL - the Neon connection string
 */

import { Client as PgClient } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseE164(input: string): string {
  const v = input.trim();
  if (!/^\+\d{8,15}$/.test(v)) {
    throw new Error(`Not a valid E.164 phone: "${v}"`);
  }
  return v;
}

function parseCsv(text: string): { email: string; phone_e164: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV is empty or missing header');
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  const phoneIdx = header.indexOf('phone_e164');
  if (emailIdx === -1 || phoneIdx === -1) {
    throw new Error('CSV header must include "email" and "phone_e164"');
  }
  const out: { email: string; phone_e164: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((s) => s.trim());
    const email = cells[emailIdx];
    const phone = cells[phoneIdx];
    if (!email || !phone) {
      console.warn(`  ⚠ row ${i + 1}: missing email or phone — skipping`);
      continue;
    }
    out.push({ email: email.toLowerCase(), phone_e164: parseE164(phone) });
  }
  return out;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/backfill-phones.ts <csv-file>');
    process.exit(1);
  }
  const POSTGRES_URL = process.env.POSTGRES_URL;
  if (!POSTGRES_URL) throw new Error('Missing POSTGRES_URL env');

  const text = readFileSync(resolve(csvPath), 'utf8');
  const rows = parseCsv(text);
  console.log(`• Parsed ${rows.length} rows from ${csvPath}`);

  const db = new PgClient({ connectionString: POSTGRES_URL });
  await db.connect();

  const stats = { updated: 0, unchanged: 0, not_found: 0, conflicts: 0 };

  try {
    for (const r of rows) {
      const { rows: matched } = await db.query<{ id: string; phone_e164: string }>(
        `SELECT id, phone_e164 FROM public.profiles WHERE LOWER(email) = $1`,
        [r.email],
      );
      if (matched.length === 0) {
        console.warn(`  ⚠ no profile for email ${r.email}`);
        stats.not_found++;
        continue;
      }
      if (matched.length > 1) {
        console.warn(`  ⚠ ${matched.length} profiles share email ${r.email} — skipping`);
        stats.conflicts++;
        continue;
      }
      const m = matched[0];
      if (m.phone_e164 === r.phone_e164) {
        stats.unchanged++;
        continue;
      }
      try {
        await db.query(
          `UPDATE public.profiles
              SET phone_e164 = $1, updated_at = NOW()
            WHERE id = $2`,
          [r.phone_e164, m.id],
        );
        stats.updated++;
      } catch (e) {
        console.warn(`  ⚠ update failed for ${r.email}: ${(e as Error).message}`);
        stats.conflicts++;
      }
    }

    console.log('\n✓ Backfill complete.');
    console.table(stats);
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
