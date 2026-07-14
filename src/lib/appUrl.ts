/**
 * The app's own absolute base URL. Resolved from APP_BASE_URL at call time (not
 * module load, so `next build` page-data collection doesn't require it). NEVER
 * derive user-facing/redirect URLs from a request's Origin/Host header — those are
 * attacker-controlled.
 */
export function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL;
  if (raw) return raw.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_BASE_URL must be set in production');
  }
  return 'http://localhost:3000';
}
