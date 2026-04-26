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
export type Role = (typeof ROLES)[number];

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
