import crypto from 'crypto';

export const PIN_RESET_CODE_TTL_MINUTES = 10;
export const PIN_RESET_MAX_ATTEMPTS = 5;
export const PIN_RESET_ACCOUNT_LIMIT_PER_HOUR = 3;
export const PIN_RESET_IP_LIMIT_PER_HOUR = 10;

function resetSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be ≥32 characters');
  return secret;
}

function hmac(value: string): string {
  return crypto.createHmac('sha256', resetSecret()).update(value).digest('hex');
}

export function generatePinResetCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Tokens are never stored in plaintext; the phone binds a code to its account. */
export function hashPinResetCode(phoneE164: string, code: string): string {
  return hmac(`pin-reset:${phoneE164}:${code}`);
}

/** Avoid storing a recoverable client IP address in the database. */
export function hashPinResetRateKey(value: string): string {
  return hmac(`pin-reset-rate:${value}`);
}

export function resetCodeMatches(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function getRequestIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown';
}
