import { redirect } from 'next/navigation';

export default async function CafeRootPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/c/${slug}/admin`);
}
