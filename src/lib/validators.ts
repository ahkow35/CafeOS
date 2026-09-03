/**
 * Input validators for the phone+PIN auth system.
 * Each function returns the normalised value or throws a `ValidationError`
 * whose .message is safe to surface to clients.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
const PIN_RE = /^\d{6}$/;
const ROLES = ['staff', 'manager', 'owner', 'part_timer'] as const;
export type MembershipRole = (typeof ROLES)[number];
// Role is kept as a backward-compat alias. Callers should migrate to MembershipRole.
export type Role = MembershipRole;

// Cafe slug: 1–32 chars, lowercase alphanumeric + hyphens, no leading/trailing
// hyphen. Mirrors db/schema.sql cafes_slug_format CHECK.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set([
  'super', 'api', 'c', 'login', 'start', 'admin',
  '_next', 'public', 'manifest', 'favicon', 'icons',
]);

export function parseE164(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('Phone is required');
  // Strip spaces, dashes, parens, dots — keep leading + and digits.
  let s = input.trim().replace(/[\s\-().]/g, '');
  // Assume Singapore (+65) when no country code given and it's 8 digits.
  if (/^\d{8}$/.test(s)) s = '+65' + s;
  if (!s.startsWith('+')) throw new ValidationError('Phone must start with + and country code');
  if (!E164_RE.test(s)) throw new ValidationError('Phone is not a valid international number');
  return s;
}

export function parsePin(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('PIN is required');
  const s = input.trim();
  if (!PIN_RE.test(s)) throw new ValidationError('PIN must be exactly 6 digits');
  return s;
}

/**
 * Validate a user-chosen PIN. Existing/admin-issued PINs remain compatible with
 * parsePin(), while self-service changes reject the easiest values to guess.
 */
export function parseNewPin(input: unknown, phoneE164?: string): string {
  const pin = parsePin(input);

  const repeatedDigit = /^(\d)\1{5}$/.test(pin);
  const commonPattern = new Set([
    '012345', '123456', '234567', '345678', '456789',
    '987654', '876543', '765432', '654321', '543210',
    '121212', '112233', '123123',
  ]).has(pin);

  if (repeatedDigit || commonPattern) {
    throw new ValidationError('Choose a less predictable PIN without repeated or sequential digits');
  }

  if (phoneE164?.replace(/\D/g, '').endsWith(pin)) {
    throw new ValidationError('Your PIN must not match the end of your mobile number');
  }

  return pin;
}

export function parseResetCode(input: unknown): string {
  if (typeof input !== 'string' || !PIN_RE.test(input.trim())) {
    throw new ValidationError('Verification code must be exactly 6 digits');
  }
  return input.trim();
}

export function parseRole(input: unknown): Role {
  if (typeof input !== 'string' || !ROLES.includes(input as Role)) {
    throw new ValidationError(`Role must be one of: ${ROLES.join(', ')}`);
  }
  return input as Role;
}

export function parseFullName(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('Full name is required');
  const s = input.trim();
  if (s.length < 1 || s.length > 100) throw new ValidationError('Full name must be 1–100 characters');
  return s;
}

export function parseJobTitle(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') throw new ValidationError('Job title must be text');
  const s = input.trim();
  if (s.length === 0) return null;
  if (s.length > 100) throw new ValidationError('Job title must be 100 characters or fewer');
  return s;
}

export function parseHourlyRate(input: unknown): number | null {
  if (input === undefined || input === null || input === '') return null;
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('Hourly rate must be a non-negative number');
  return Math.round(n * 100) / 100;
}

export function parseCafeSlug(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('Cafe slug is required');
  const s = input.trim().toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw new ValidationError(
      'Slug must be 1–32 lowercase letters, digits, or hyphens (no leading/trailing hyphen)',
    );
  }
  if (RESERVED_SLUGS.has(s)) {
    throw new ValidationError(`"${s}" is a reserved slug and cannot be used`);
  }
  return s;
}

export function parseCafeName(input: unknown): string {
  if (typeof input !== 'string') throw new ValidationError('Cafe name is required');
  const s = input.trim();
  if (s.length < 1 || s.length > 100) throw new ValidationError('Cafe name must be 1–100 characters');
  return s;
}

export function parseEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ValidationError('Invalid email address');
  }
  if (trimmed.length > 254) throw new ValidationError('Email address is too long');
  return trimmed;
}

/** Derive a URL-safe slug from a display name. Auto-appends -2/-3 etc if given
 *  a suffix number (caller is responsible for collision-checking in the DB). */
export function slugifyName(name: string, suffix?: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  const result = suffix ? `${base}-${suffix}` : base;
  if (!SLUG_RE.test(result) || RESERVED_SLUGS.has(result)) {
    throw new ValidationError('Cannot generate a valid slug from this name');
  }
  return result;
}

// Money: digits with an optional 1–2 digit fraction. Checked on the STRING so
// "1.234" is rejected outright instead of being silently rounded.
const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * Parse a currency amount (SGD). Rejects anything that is not a plain decimal
 * with at most two places. Default range is (0, 9999.99]; pass `allowZero`
 * for caps/balances and `max` to widen.
 */
export function parseMoney(
  input: unknown,
  label: string,
  opts: { max?: number; allowZero?: boolean } = {},
): number {
  const raw = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : '';
  if (!MONEY_RE.test(raw)) {
    throw new ValidationError(`${label} must be an amount with at most 2 decimal places`);
  }
  const n = Number(raw);
  const max = opts.max ?? 9999.99;
  if (n === 0 && !opts.allowZero) throw new ValidationError(`${label} must be greater than 0`);
  if (n > max) throw new ValidationError(`${label} cannot exceed ${max.toFixed(2)}`);
  return n;
}
