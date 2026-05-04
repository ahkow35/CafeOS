import { NextResponse, after } from 'next/server';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { sql } from '@/lib/db';
import { parseE164, parseFullName, parseCafeName, slugifyName, ValidationError } from '@/lib/validators';
import { hashPin } from '@/lib/auth';
import { notifyCafeSignup } from '@/lib/notifications';

export const runtime = 'nodejs';

// Per-instance rate limiter: max 5 submissions per 10 minutes from the same IP.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    throw new ValidationError('Too many signup attempts. Please try again later.');
  }
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  try {
    checkRateLimit(ip);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const cafeName = parseCafeName(body.cafeName);
    const ownerName = parseFullName(body.ownerName);
    const ownerPhone = parseE164(body.ownerPhone);

    // Generate a unique slug. Try up to 10 suffixes (-2 through -10).
    let slug: string | null = null;
    for (let i = 0; i <= 9; i++) {
      const candidate = slugifyName(cafeName, i === 0 ? undefined : i + 1);
      const { rows } = await sql<{ slug: string }>`SELECT slug FROM cafes WHERE slug = ${candidate} LIMIT 1`;
      if (rows.length === 0) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      return NextResponse.json(
        { error: 'Could not generate a unique slug for this name. Try a slightly different name.' },
        { status: 409 },
      );
    }

    // Find or create the owner profile.
    const { rows: existingProfile } = await sql<{ id: string }>`
      SELECT id FROM profiles WHERE phone_e164 = ${ownerPhone} LIMIT 1
    `;

    let profileId: string;
    if (existingProfile.length > 0) {
      profileId = existingProfile[0].id;
    } else {
      // Placeholder hash — cannot match any real 6-digit PIN. Profile stays
      // is_active=false until super admin approves and issues a real PIN.
      const placeholderHash = await hashPin(crypto.randomBytes(32).toString('hex'));
      const { rows: created } = await sql<{ id: string }>`
        INSERT INTO profiles (phone_e164, full_name, pin_hash, is_active, is_super_admin)
        VALUES (${ownerPhone}, ${ownerName}, ${placeholderHash}, FALSE, FALSE)
        RETURNING id
      `;
      profileId = created[0].id;
    }

    // Prevent duplicate applications.
    const { rows: existing } = await sql<{ status: string }>`
      SELECT c.status FROM cafes c
        JOIN cafe_memberships m ON m.cafe_id = c.id
       WHERE m.user_id = ${profileId}
         AND m.role = 'owner'
       ORDER BY c.created_at DESC
       LIMIT 1
    `;
    if (existing.length > 0) {
      const status = existing[0].status;
      if (status === 'pending') {
        return NextResponse.json(
          { error: 'A signup request for this phone number is already pending review.' },
          { status: 409 },
        );
      }
      if (status === 'active') {
        return NextResponse.json(
          { error: 'This phone number already has an active cafe. Log in at /login.' },
          { status: 409 },
        );
      }
    }

    // Insert cafe + ownership membership atomically.
    const { rows: cafeRows } = await sql<{ id: string }>`
      INSERT INTO cafes (slug, name, status, created_by)
      VALUES (${slug}, ${cafeName}, 'pending', ${profileId})
      RETURNING id
    `;
    const cafeId = cafeRows[0].id;

    await sql`
      INSERT INTO cafe_memberships (cafe_id, user_id, role, status)
      VALUES (${cafeId}, ${profileId}, 'owner', 'pending')
    `;

    // Notify super admins out-of-band.
    const capturedCafeName = cafeName;
    const capturedOwnerName = ownerName;
    const capturedOwnerPhone = ownerPhone;
    after(async () => {
      try {
        await notifyCafeSignup({
          cafeName: capturedCafeName,
          ownerName: capturedOwnerName,
          ownerPhone: capturedOwnerPhone,
        });
      } catch (err) {
        console.error('notifyCafeSignup error:', err);
      }
    });

    return NextResponse.json(
      { ok: true, message: 'Application submitted. We will contact you once it is reviewed.' },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error('start POST error', e);
    return NextResponse.json({ error: 'Failed to submit application' }, { status: 500 });
  }
}
