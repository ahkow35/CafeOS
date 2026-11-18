import LoginForm, { type LoginNotice } from './LoginForm';

function parseNotice(value: string | string[] | undefined): LoginNotice | undefined {
  return value === 'cafe-suspended' || value === 'cafe-pending' ? value : undefined;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string | string[] }> }) {
  const { notice } = await searchParams;
  return <LoginForm notice={parseNotice(notice)} />;
}
