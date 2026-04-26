/**
 * Supabase → Neon (Vercel Postgres) one-shot data migration.
 *
 * What it does:
 *   1. Reads every preserved table from the old Supabase Postgres.
 *   2. Copies medical-cert files from Supabase Storage → Vercel Blob.
 *   3. Inserts rows into the new Neon database, preserving UUIDs and
 *      rewriting `attachment_url` to point at Vercel Blob.
 *   4. Generates placeholder phone numbers and a default PIN ('000000')
 *      for every existing profile so they can log in until the admin runs
 *      `scripts/backfill-phones.ts` against the real CSV.
 *
 * Run from a workstation that can reach BOTH databases:
 *   npx tsx scripts/migrate-supabase-to-neon.ts
 *
 * Required env (in .env.local or shell):
 *   SUPABASE_DB_URL                 - postgres://... (Supabase direct URL, not pooler)
 *   SUPABASE_URL                    - https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY       - service role key for storage download
 *   SUPABASE_BUCKET                 - usually 'medical_certificates'
 *   POSTGRES_URL                    - Neon connection string (the one Vercel injects)
 *   BLOB_READ_WRITE_TOKEN           - Vercel Blob token
 *   DEFAULT_PIN                     - optional; default '000000'
 *
 * Idempotency:
 *   - Profiles: ON CONFLICT (id) DO NOTHING — safe to re-run, but won't
 *     re-overwrite. Delete affected rows on Neon if you need a clean rerun.
 *   - All other tables: ON CONFLICT (id) DO NOTHING.
 */

import { Client as PgClient } from 'pg';
import { put } from '@vercel/blob';
import bcrypt from 'bcryptjs';

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string;
  role: 'staff' | 'manager' | 'owner' | 'part_timer';
  hourly_rate: number | null;
  annual_leave_balance: number;
  medical_leave_balance: number;
  is_active: boolean;
  created_at: string;
};

type LeaveRow = {
  id: string;
  user_id: string;
  leave_type: 'annual' | 'medical';
  start_date: string;
  end_date: string;
  days_requested: number;
  status: 'pending_manager' | 'pending_owner' | 'approved' | 'rejected';
  reason: string | null;
  attachment_url: string | null;
  is_retrospective: boolean;
  manager_action_by: string | null;
  manager_action_at: string | null;
  owner_action_by: string | null;
  owner_action_at: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  assigned_to: string;
  status: 'pending' | 'done';
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

type TimesheetRow = {
  id: string;
  user_id: string;
  month_year: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  comments: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  employee_signature: string | null;
  manager_signature: string | null;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  timesheet_id: string;
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
  break_hours: number;
  total_hours: number;
  remarks: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string;
  actor_id: string | null;
  action: string;
  before_state: unknown;
  after_state: unknown;
  created_at: string;
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main() {
  const SUPABASE_DB_URL = need('SUPABASE_DB_URL');
  const SUPABASE_URL = need('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
  const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? 'medical_certificates';
  const POSTGRES_URL = need('POSTGRES_URL');
  need('BLOB_READ_WRITE_TOKEN'); // @vercel/blob reads it directly
  const DEFAULT_PIN = process.env.DEFAULT_PIN ?? '000000';

  const src = new PgClient({ connectionString: SUPABASE_DB_URL });
  const dst = new PgClient({ connectionString: POSTGRES_URL });
  await src.connect();
  await dst.connect();

  const stats = {
    profiles: 0,
    leave_requests: 0,
    leave_requests_skipped: 0,
    tasks: 0,
    tasks_skipped: 0,
    timesheets: 0,
    timesheets_skipped: 0,
    timesheet_entries: 0,
    audit_log: 0,
    blobs_copied: 0,
    blob_failures: 0,
    fk_nulled: 0,
  };

  // Set of valid profile IDs after migration; used to NULL orphan FK refs.
  const validProfileIds = new Set<string>();
  const nullIfOrphan = (id: string | null | undefined): string | null => {
    if (!id) return null;
    if (validProfileIds.has(id)) return id;
    stats.fk_nulled++;
    return null;
  };

  try {
    console.log('• Hashing default PIN...');
    const defaultPinHash = await bcrypt.hash(DEFAULT_PIN, 12);

    // ── PROFILES ──────────────────────────────────────────────────────────
    console.log('• Migrating profiles...');
    const profiles = await src.query<ProfileRow>(`
      SELECT id, email, full_name, role, hourly_rate,
             annual_leave_balance, medical_leave_balance, is_active, created_at
        FROM public.profiles
       ORDER BY created_at ASC
    `);
    for (let i = 0; i < profiles.rows.length; i++) {
      const p = profiles.rows[i];
      const placeholderPhone = `+0000000${String(i + 1).padStart(4, '0')}`;
      await dst.query(
        `INSERT INTO public.profiles
            (id, phone_e164, full_name, job_title, role, pin_hash,
             annual_leave_balance, medical_leave_balance, hourly_rate,
             is_active, email, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id, placeholderPhone, p.full_name, p.role, defaultPinHash,
          p.annual_leave_balance, p.medical_leave_balance, p.hourly_rate,
          p.is_active, p.email, p.created_at,
        ],
      );
      validProfileIds.add(p.id);
      stats.profiles++;
    }

    // ── LEAVE REQUESTS (with blob copy for medical certs) ────────────────
    console.log('• Migrating leave_requests + medical certs...');
    const leaves = await src.query<LeaveRow>(`
      SELECT id, user_id, leave_type, start_date, end_date, days_requested,
             status, reason, attachment_url, is_retrospective,
             manager_action_by, manager_action_at, owner_action_by, owner_action_at,
             created_at, updated_at
        FROM public.leave_requests
       ORDER BY created_at ASC
    `);

    for (const l of leaves.rows) {
      // Skip rows whose owning user no longer exists.
      if (!validProfileIds.has(l.user_id)) {
        console.warn(`  ⚠ skipping leave ${l.id}: user_id ${l.user_id} not in profiles`);
        stats.leave_requests_skipped++;
        continue;
      }
      let newAttachmentUrl: string | null = l.attachment_url;
      if (l.attachment_url) {
        try {
          // attachment_url stored either as bare filename or full Supabase public URL
          const path = extractSupabasePath(l.attachment_url);
          const blob = await downloadFromSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET, path);
          const filename = path.split('/').pop() ?? 'mc';
          const { url } = await put(
            `medical-certificates/${l.user_id}/${Date.now()}-${sanitize(filename)}`,
            blob.body,
            { access: 'public', contentType: blob.contentType, addRandomSuffix: false },
          );
          newAttachmentUrl = url;
          stats.blobs_copied++;
        } catch (e) {
          console.warn(`  ⚠ blob copy failed for leave ${l.id}: ${(e as Error).message}`);
          stats.blob_failures++;
          // keep original string so we can backfill manually later
        }
      }

      await dst.query(
        `INSERT INTO public.leave_requests
            (id, user_id, leave_type, start_date, end_date, days_requested,
             status, reason, attachment_url, is_retrospective,
             manager_action_by, manager_action_at, owner_action_by, owner_action_at,
             created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO NOTHING`,
        [
          l.id, l.user_id, l.leave_type, l.start_date, l.end_date, l.days_requested,
          l.status, l.reason, newAttachmentUrl, l.is_retrospective,
          nullIfOrphan(l.manager_action_by), l.manager_action_at,
          nullIfOrphan(l.owner_action_by), l.owner_action_at,
          l.created_at, l.updated_at,
        ],
      );
      stats.leave_requests++;
    }

    // ── TASKS ─────────────────────────────────────────────────────────────
    console.log('• Migrating tasks...');
    const tasks = await src.query<TaskRow>(`
      SELECT id, title, description, deadline, assigned_to, status,
             created_by, completed_by, completed_at, created_at
        FROM public.tasks
       ORDER BY created_at ASC
    `);
    for (const t of tasks.rows) {
      // tasks.created_by is NOT NULL — skip if creator no longer exists.
      if (t.created_by && !validProfileIds.has(t.created_by)) {
        console.warn(`  ⚠ skipping task ${t.id}: created_by ${t.created_by} not in profiles`);
        stats.tasks_skipped++;
        continue;
      }
      await dst.query(
        `INSERT INTO public.tasks
            (id, title, description, deadline, assigned_to, status,
             created_by, completed_by, completed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id, t.title, t.description, t.deadline,
          nullIfOrphan(t.assigned_to), t.status,
          t.created_by, nullIfOrphan(t.completed_by), t.completed_at, t.created_at,
        ],
      );
      stats.tasks++;
    }

    // ── TIMESHEETS ────────────────────────────────────────────────────────
    console.log('• Migrating timesheets...');
    const sheets = await src.query<TimesheetRow>(`
      SELECT id, user_id, month_year, status, comments, rejection_reason,
             approved_by, approved_at, employee_signature, manager_signature,
             created_at, updated_at
        FROM public.timesheets
       ORDER BY created_at ASC
    `);
    for (const ts of sheets.rows) {
      if (!validProfileIds.has(ts.user_id)) {
        console.warn(`  ⚠ skipping timesheet ${ts.id}: user_id ${ts.user_id} not in profiles`);
        stats.timesheets_skipped++;
        continue;
      }
      await dst.query(
        `INSERT INTO public.timesheets
            (id, user_id, month_year, status, comments, rejection_reason,
             approved_by, approved_at, employee_signature, manager_signature,
             created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          ts.id, ts.user_id, ts.month_year, ts.status, ts.comments, ts.rejection_reason,
          nullIfOrphan(ts.approved_by), ts.approved_at,
          ts.employee_signature, ts.manager_signature,
          ts.created_at, ts.updated_at,
        ],
      );
      stats.timesheets++;
    }

    // ── TIMESHEET ENTRIES ─────────────────────────────────────────────────
    console.log('• Migrating timesheet_entries...');
    const entries = await src.query<EntryRow>(`
      SELECT id, timesheet_id, entry_date, start_time, end_time,
             break_hours, total_hours, remarks, created_at
        FROM public.timesheet_entries
       ORDER BY created_at ASC
    `);
    for (const e of entries.rows) {
      await dst.query(
        `INSERT INTO public.timesheet_entries
            (id, timesheet_id, entry_date, start_time, end_time,
             break_hours, total_hours, remarks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          e.id, e.timesheet_id, e.entry_date, e.start_time, e.end_time,
          e.break_hours, e.total_hours, e.remarks, e.created_at,
        ],
      );
      stats.timesheet_entries++;
    }

    // ── AUDIT LOG (best-effort; skip if table absent on either side) ─────
    console.log('• Migrating audit_log...');
    try {
      const audits = await src.query<AuditRow>(`
        SELECT id, table_name, record_id, actor_id, action,
               before_state, after_state, created_at
          FROM public.audit_log
         ORDER BY created_at ASC
      `);
      for (const a of audits.rows) {
        await dst.query(
          `INSERT INTO public.audit_log
              (id, table_name, record_id, actor_id, action,
               before_state, after_state, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            a.id, a.table_name, a.record_id, a.actor_id, a.action,
            a.before_state, a.after_state, a.created_at,
          ],
        );
        stats.audit_log++;
      }
    } catch (e) {
      console.warn(`  ⚠ audit_log skipped: ${(e as Error).message}`);
    }

    console.log('\n✓ Migration complete.');
    console.table(stats);
    console.log('\nNext steps:');
    console.log('  1. Hand the user a CSV: email,phone_e164');
    console.log(`  2. Run: npx tsx scripts/backfill-phones.ts <path-to-csv>`);
    console.log(`  3. Default PIN for everyone is "${DEFAULT_PIN}" — distribute and rotate.`);
  } finally {
    await src.end().catch(() => {});
    await dst.end().catch(() => {});
  }
}

function extractSupabasePath(url: string): string {
  const marker = '/object/public/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // already a bare path
  // strip "/object/public/{bucket}/"
  const after = url.slice(idx + marker.length);
  const slash = after.indexOf('/');
  return slash === -1 ? after : after.slice(slash + 1);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function downloadFromSupabase(
  baseUrl: string,
  serviceKey: string,
  bucket: string,
  path: string,
): Promise<{ body: Buffer; contentType: string | undefined }> {
  // Use the Storage REST endpoint with service-role JWT — works for any bucket.
  const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${serviceKey}` } });
  if (!res.ok) throw new Error(`storage fetch ${res.status} for ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { body: buf, contentType: res.headers.get('content-type') ?? undefined };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
