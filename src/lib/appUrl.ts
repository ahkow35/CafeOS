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

/**
 * Username (no leading @) of the CafeOS Telegram bot, used to build the
 * /start deep link for the instant café signup flow. Resolved at call time
 * (not module load) for the same reason as appBaseUrl() — `next build`
 * page-data collection must not require it.
 */
export function telegramBotUsername(): string {
  const raw = process.env.TELEGRAM_BOT_USERNAME;
  if (raw) return raw;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TELEGRAM_BOT_USERNAME must be set in production');
  }
  return 'your_bot'; // dev-only placeholder — set TELEGRAM_BOT_USERNAME to test the real deep link
}
