import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPin, requireTenantUser, requireOwnerInCafe, AuthError } from '@/lib/auth';
import { parsePin, ValidationError } from '@/lib/validators';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generatePin(): string {
  // Cryptographically uniform 6-digit PIN.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  return String((n >>> 0) % 1_000_000).padStart(6, '0');
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenantUser();
    requireOwnerInCafe(ctx);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });

    // Verify the target user is a member of this cafe before touching their PIN.
    const { rows: memberRows } = await sql`
      SELECT 1 FROM cafe_memberships
       WHERE cafe_id = ${ctx.cafeId}
         AND user_id = ${id}
         AND status  = 'active'
       LIMIT 1
    `;
    if (memberRows.length === 0) {
      return NextResponse.json({ error: 'User not found in this cafe' }, { status: 404 });
    }

    // The PIN is a GLOBAL login credential. If this person also belongs to other
    // cafés, an owner resetting it could then log in as them elsewhere — so an
    // owner may only reset the PIN of a user who belongs solely to this café.
    // Multi-café users must recover their PIN through their own session.
    const { rows: cafeCountRows } = await sql<{ n: number }>`
      SELECT COUNT(*)::int AS n FROM cafe_memberships
       WHERE user_id = ${id} AND status = 'active'
    `;
    if ((cafeCountRows[0]?.n ?? 0) > 1) {
      return NextResponse.json(
        { error: 'This user belongs to other cafés. They must reset their own PIN from their account.' },
        { status: 409 },
      );
    }

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Owner may supply a PIN explicitly; otherwise we generate one.
    const pin = body.pin === undefined ? generatePin() : parsePin(body.pin);
    const pin_hash = await hashPin(pin);

    // Bump token_version to revoke any sessions the user (or anyone holding a
    // stale/hijacked token) currently has — a reset must invalidate old logins.
    const { rowCount } = await sql`
      UPDATE profiles
         SET pin_hash        = ${pin_hash},
             failed_attempts = 0,
             locked_until    = NULL,
             token_version   = token_version + 1,
             updated_at      = NOW()
       WHERE id = ${id}
    `;
    if (!rowCount) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ tempPin: pin });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) {
      const status = e.code === 'unauthorized' ? 401 : 403;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error('admin/users reset-pin error', e);
    return NextResponse.json({ error: 'Failed to reset PIN' }, { status: 500 });
  }
}
