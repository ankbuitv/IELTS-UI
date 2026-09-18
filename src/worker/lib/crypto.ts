/**
 * Password hashing and session-token hashing.
 *
 * Password storage: PBKDF2-HMAC-SHA256 with a per-user random salt and an
 * iteration count stored alongside the hash so it can be raised later without
 * invalidating existing credentials. Passwords are never stored, logged or
 * returned in any API response.
 */

// Cloudflare Workers' WebCrypto caps PBKDF2 at 100,000 iterations
// ("iteration counts above 100000 are not supported"), so 100,000 is the
// highest count this platform can use without breaking registration.
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
  algo: string;
}

export async function hashPassword(
  password: string,
  options: { iterations?: number; salt?: string } = {},
): Promise<PasswordHash> {
  const iterations = options.iterations ?? PBKDF2_ITERATIONS;
  const salt = options.salt ?? toBase64Url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64Url(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS,
  );

  return {
    hash: toBase64Url(new Uint8Array(derived)),
    salt,
    iterations,
    algo: 'PBKDF2-SHA256',
  };
}

/** Constant-time comparison for two equal-length strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored.hash || !stored.salt) return false;
  const computed = await hashPassword(password, { iterations: stored.iterations, salt: stored.salt });
  return timingSafeEqual(computed.hash, stored.hash);
}

/**
 * Session ids are stored hashed so a database read cannot be replayed as a
 * valid cookie. The app secret acts as a pepper.
 */
export async function hashSessionToken(token: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper || 'dev-pepper'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return toBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateLoginCode(): string {
  // 8 character base32-ish code, human readable, ~40 bits of entropy.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Deterministic anonymous identifier for rate-limit buckets so raw IPs are not
 * persisted in counters.
 */
export async function hashIp(ip: string, pepper: string): Promise<string> {
  return (await hashSessionToken(`ip:${ip}`, pepper)).slice(0, 24);
}
