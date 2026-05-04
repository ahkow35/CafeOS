import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

interface CafeRow {
  slug: string;
  name: string;
  logo_url: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { rows } = await sql<CafeRow>`
    SELECT slug, name, logo_url FROM cafes WHERE slug = ${slug} AND status = 'active' LIMIT 1
  `;
  const cafe = rows[0];

  const name = cafe?.name ?? 'CafeOS';
  const icons = cafe?.logo_url
    ? [{ src: cafe.logo_url, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ];

  const manifest = {
    name: `${name} - Staff Portal`,
    short_name: name,
    description: 'Staff leave and task management',
    start_url: `/c/${slug}/`,
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons,
  };

  return NextResponse.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
