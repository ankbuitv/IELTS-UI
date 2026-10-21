/**
 * RFC 6238 TOTP + one-time login codes.
 *
 * Pure WebCrypto (HMAC-SHA1) so the Worker needs no dependency: authenticator
 * apps scan an otpauth:// URI (or the user types the base32 secret), and the
 * six-digit codes are verified with a ±1 step window to tolerate clock drift.
 * Login OTPs are stored as PBKDF2 hashes (same helper as passwords) and are
 * single-use.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 20 random bytes, base32-encoded — the shared secret for an authenticator app. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function hotp(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  // Counter as a 64-bit big-endian integer (high 32 bits are always 0 here).
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = signature[signature.length - 1]! & 0x0f;
  const code =
    (((signature[offset]! & 0x7f) << 24) |
      ((signature[offset + 1]! & 0xff) << 16) |
      ((signature[offset + 2]! & 0xff) << 8) |
      (signature[offset + 3]! & 0xff)) %
    1_000_000;
  return String(code).padStart(6, '0');
}

/** The current six-digit code for a secret (30-second steps). */
export function totpCode(secret: string, atMs = Date.now()): Promise<string> {
  return hotp(secret, Math.floor(atMs / 30_000));
}

/** Accepts the previous, current and next step to tolerate small clock drift. */
export async function verifyTotp(secret: string, code: string, atMs = Date.now()): Promise<boolean> {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(atMs / 30_000);
  for (const candidate of [step - 1, step, step + 1]) {
    if ((await hotp(secret, candidate)) === clean) return true;
  }
  return false;
}

/** otpauth:// URI — authenticator apps set themselves up from this link. */
export function totpAuthUrl(account: string, issuer: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** A friendly six-character one-time code (no ambiguous letters). */
export function generateOtpCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte! % alphabet.length]!).join('');
}
