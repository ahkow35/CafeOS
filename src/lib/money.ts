/**
 * Money helpers. Postgres NUMERIC arrives from @vercel/postgres as a string;
 * convert exactly once at the API boundary. Never do arithmetic on the result —
 * balance math lives in SQL.
 */

export function toMoney(v: string | number | null): number {
  if (v === null) return 0;
  return Math.round(Number(v) * 100) / 100;
}

export function toMoneyOrNull(v: string | number | null): number | null {
  return v === null ? null : toMoney(v);
}

const SGD = new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatSGD(n: number): string {
  return `S$${SGD.format(n)}`;
}
