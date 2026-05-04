import { NextResponse } from 'next/server';
import { sql, withTx } from '@/lib/db';
import { requireSuperAdmin, hashPin, AuthError } from '@/lib/auth';
import crypto from 'crypto';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const admin = await requireSuperAdmin();
    const { id: cafeId } = await params;
    if (!UUID_RE.test(cafeId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rows: cafeRows } = await sql<{ status: string }>`
      SELECT status FROM cafes WHERE id = ${cafeId} LIMIT 1
    `;
    if (cafeRows.length === 0) return NextResponse.json({ error: 'Cafe not found' }, { status: 404 });
    if (cafeRows[0].status !== 'pending') {
      return NextResponse.json({ error: 'Only pending cafes can be approved' }, { status: 409 });
    }

    // Generate a random 6-digit PIN.
    const pin = crypto.randomInt(100000, 999999).toString().padStart(6, '0');
    const pinHash = await hashPin(pin);

    await withTx(admin.id, async (tx) => {
      // Activate the cafe.
      await tx.query(
        `UPDATE cafes SET status = 'active', approved_by = $1, approved_at = NOW(), updated_at = NOW()
          WHERE id = $2`,
        [admin.id, cafeId],
      );

      // Activate the owner membership and return the owner's user_id.
      const { rows: owners } = await tx.query<{ user_id: string }>(
        `UPDATE cafe_memberships SET status = 'active'
          WHERE cafe_id = $1 AND role = 'owner'
          RETURNING user_id`,
        [cafeId],
      );

      // Activate the owner profile and set their PIN.
      if (owners.length > 0) {
        for (const { user_id } of owners) {
          await tx.query(
            `UPDATE profiles SET is_active = TRUE, pin_hash = $1, updated_at = NOW()
              WHERE id = $2`,
            [pinHash, user_id],
          );
        }
      }
    });

    // Return the plain PIN once — super admin delivers it out-of-band (phone / Telegram).
    return NextResponse.json({ ok: true, pin });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.code === 'unauthorized' ? 401 : 403 });
    }
    console.error('super/cafes/[id]/approve POST error', e);
    return NextResponse.json({ error: 'Failed to approve cafe' }, { status: 500 });
  }
}
