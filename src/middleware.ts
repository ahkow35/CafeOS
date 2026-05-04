import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Paths that never require a session.
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/login/select',
  '/start',
]);

const PUBLIC_PREFIX = [
  '/_next',
  '/icons',
  '/api/auth/',
  '/api/telegram/',
  '/api/start',
  '/api/ping',
];

const SESSION_COOKIE = 'cafeos_session';

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be ≥32 characters');
  return new TextEncoder().encode(s);
}

interface Claims {
  sub: string;
  cafe_id: string | null;
  cafe_slug: string | null;
  role: string | null;
  is_super_admin: boolean;
}

async function verify(token: string | undefined): Promise<Claims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      cafe_id: (payload.cafe_id as string | null) ?? null,
      cafe_slug: (payload.cafe_slug as string | null) ?? null,
      role: (payload.role as string | null) ?? null,
      is_super_admin: Boolean(payload.is_super_admin),
    };
  } catch {
    return null;
  }
}

function redirect(req: NextRequest, pathname: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets & PWA manifest — no auth.
  if (
    pathname === '/manifest.json' ||
    pathname === '/favicon.ico' ||
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIX.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  const claims = await verify(request.cookies.get(SESSION_COOKIE)?.value);

  // Not authenticated.
  if (!claims) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return redirect(request, '/login');
  }

  // ── /super/** — platform super admin only ──────────────────────────────────
  if (pathname.startsWith('/super') || pathname.startsWith('/api/super')) {
    if (!claims.is_super_admin) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return redirect(request, '/');
    }
    return NextResponse.next();
  }

  // ── /c/[slug]/** — tenant-scoped routes ────────────────────────────────────
  if (pathname.startsWith('/c/') || pathname.startsWith('/api/c/')) {
    const parts = pathname.split('/');
    // parts[0]='' parts[1]='c' parts[2]=slug
    const urlSlug = parts[2];
    if (!urlSlug) return notFound();

    // Slug in URL must match the active cafe in the session.
    // Returns 404 (not 403) to avoid leaking whether a cafe exists.
    if (urlSlug !== claims.cafe_slug) {
      if (pathname.startsWith('/api/')) return notFound();
      // If authenticated but wrong cafe, redirect them to their own cafe.
      if (claims.cafe_slug) return redirect(request, `/c/${claims.cafe_slug}/`);
      // Super admin without an active cafe — go to /super.
      if (claims.is_super_admin) return redirect(request, '/super');
      return redirect(request, '/login');
    }

    // Role-gate: /c/[slug]/admin/** and /api/c/[slug]/admin/** — manager/owner only.
    const rest = '/' + parts.slice(3).join('/');
    if (rest.startsWith('/admin') && claims.role !== 'manager' && claims.role !== 'owner') {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return redirect(request, `/c/${claims.cafe_slug}/`);
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|manifest.json).*)'],
};
