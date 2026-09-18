const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Short, prefixed, URL-safe identifiers (e.g. `att_9f2k1...`). */
export function newId(prefix: string, length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function secondsBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function asBoolInt(value: unknown): 0 | 1 {
  return value ? 1 : 0;
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
