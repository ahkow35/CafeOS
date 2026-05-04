import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireTenantUser, AuthError } from '@/lib/auth';

interface CafeRow {
  slug: string;
  name: string;
  logo_url: string | null;
}

async function getCafe(slug: string): Promise<CafeRow | null> {
  const { rows } = await sql<CafeRow>`
    SELECT slug, name, logo_url
      FROM cafes
     WHERE slug = ${slug} AND status = 'active'
     LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const cafe = await getCafe(slug);
  if (!cafe) return { title: 'CafeOS' };

  return {
    title: cafe.name,
    manifest: `/c/${slug}/manifest.json`,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: cafe.name,
    },
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let impersonatorId: string | undefined;

  try {
    const ctx = await requireTenantUser();
    impersonatorId = ctx.impersonatorId;
  } catch (e) {
    if (e instanceof AuthError) {
      if (e.code === 'unauthorized' || e.code === 'need_cafe_selection') {
        redirect('/login');
      }
      if (e.code === 'cafe_suspended' || e.code === 'cafe_pending') {
        redirect('/login?suspended=1');
      }
    }
    redirect('/login');
  }

  void slug;
  return (
    <>
      {impersonatorId && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#7c3aed', color: '#fff', textAlign: 'center',
          padding: '6px 16px', fontSize: '13px', fontWeight: 600,
        }}>
          👁 Impersonation mode — <a href="/super" style={{ color: '#e9d5ff', textDecoration: 'underline' }}>back to super admin</a>
        </div>
      )}
      <div style={impersonatorId ? { paddingTop: '32px' } : undefined}>
        {children}
      </div>
    </>
  );
}
