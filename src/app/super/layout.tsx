import { redirect } from 'next/navigation';
import { requireSuperAdmin, AuthError } from '@/lib/auth';
import type { ReactNode } from 'react';

export const metadata = { title: 'CafeOS Super Admin' };

export default async function SuperLayout({ children }: { children: ReactNode }) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof AuthError && e.code !== 'unauthorized') {
      redirect('/');
    }
    redirect('/login');
  }
  return <>{children}</>;
}
