import { describe, expect, it } from 'vitest';
import { stripFramingHeader } from '../../scripts/lib/local-preview-headers.mjs';
import {
  fromBase64Url,
  generateLoginCode,
  hashIp,
  hashPassword,
  hashSessionToken,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  toBase64Url,
  verifyPassword,
} from '../../src/worker/lib/crypto';
import { asBoolInt, clamp, isoPlusSeconds, newId, parseJson, secondsBetween } from '../../src/worker/lib/ids';

describe('password hashing', () => {
  it('never stores the plaintext and verifies the right password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.hash).not.toContain('correct horse');
    expect(stored.salt).toBeTruthy();
    expect(stored.algo).toBe('PBKDF2-SHA256');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('uses a distinct salt per user so identical passwords differ', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('records the iteration count so it can be raised later', async () => {
    const stored = await hashPassword('pw', { iterations: 1000 });
    expect(stored.iterations).toBe(1000);
    expect(await verifyPassword('pw', stored)).toBe(true);
  });

  it('survives a corrupt or empty stored hash instead of throwing', async () => {
    await expect(verifyPassword('pw', { hash: '', salt: '', iterations: 1000, algo: 'PBKDF2-SHA256' })).resolves.toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares equal strings as equal', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('rejects different strings and different lengths', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('session tokens', () => {
  it('hashes session ids so a database leak cannot be replayed', async () => {
    const token = randomToken(32);
    const hashed = await hashSessionToken(token, 'pepper');
    expect(hashed).not.toBe(token);
    expect(hashed).toBe(await hashSessionToken(token, 'pepper'));
  });

  it('produces a different hash for a different pepper', async () => {
    const token = randomToken(32);
    expect(await hashSessionToken(token, 'pepper-a')).not.toBe(await hashSessionToken(token, 'pepper-b'));
  });

  it('generates high-entropy values', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => randomToken(32)));
    expect(tokens.size).toBe(64);
    expect(randomToken(32).length).toBeGreaterThan(30);
  });
});

describe('sha256Hex', () => {
  it('matches a known digest for the empty input', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes buffers and strings consistently', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes)).toBe(await sha256Hex('abc'));
  });
});

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
  });
});

describe('rate-limit / ip hashing', () => {
  it('derives a stable anonymous bucket id instead of storing raw IPs', async () => {
    const bucket = await hashIp('203.0.113.9', 'pepper');
    expect(bucket).not.toContain('203.0.113.9');
    expect(bucket).toBe(await hashIp('203.0.113.9', 'pepper'));
    expect(bucket).not.toBe(await hashIp('203.0.113.10', 'pepper'));
  });

  it('generates readable login codes without ambiguous characters', () => {
    const code = generateLoginCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });
});

describe('id and time helpers', () => {
  it('prefixes ids and keeps them unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('tst')));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^tst_[A-Za-z0-9]+$/);
  });

  it('computes deadlines from ISO strings', () => {
    const later = isoPlusSeconds('2026-01-01T00:00:00.000Z', 90);
    expect(later).toBe('2026-01-01T00:01:30.000Z');
    expect(secondsBetween('2026-01-01T00:00:00.000Z', later)).toBe(90);
  });

  it('clamps to the requested bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('normalises booleans to SQLite integers', () => {
    expect(asBoolInt(true)).toBe(1);
    expect(asBoolInt(false)).toBe(0);
    expect(asBoolInt(1)).toBe(1);
    expect(asBoolInt(0)).toBe(0);
    expect(asBoolInt(undefined)).toBe(0);
  });

  it('parses JSON defensively', () => {
    expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(parseJson('broken', { fallback: true })).toEqual({ fallback: true });
    expect(parseJson(null, [])).toEqual([]);
  });
});

describe('development framing', () => {
  it('strips x-frame-options from the local build only', () => {
    const source = ['/*', '  x-content-type-options: nosniff', '  x-frame-options: SAMEORIGIN', '  referrer-policy: no-referrer', ''].join('\n');
    const local = stripFramingHeader(source);
    expect(local).not.toContain('x-frame-options');
    expect(local).toContain('x-content-type-options: nosniff');
    expect(local).toContain('referrer-policy: no-referrer');
  });

  it('leaves a file without the header unchanged', () => {
    const source = '/*\n  x-content-type-options: nosniff\n';
    expect(stripFramingHeader(source)).toBe(source);
  });
});
