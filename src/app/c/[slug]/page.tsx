import { redirect } from 'next/navigation';
import { requireTenantUser } from '@/lib/auth';

export default async function CafeRootPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenantUser();

  if (ctx.role === 'manager' || ctx.role === 'owner') {
    redirect(`/c/${slug}/admin`);
  }
  if (ctx.role === 'part_timer') {
    redirect(`/c/${slug}/timesheet`);
  }
  redirect(`/c/${slug}/tasks`);
}
