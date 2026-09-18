import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { ApiError } from './errors';
import { hashIp } from './crypto';
import type { AppBindings } from '../env';

export function json<T>(c: Context, data: T, status = 200): Response {
  return c.json(data as never, status as never);
}

export function cookieName(c: Context<AppBindings>): string {
  return c.env.SESSION_COOKIE_NAME || 'ielts_session';
}

export function clientIp(c: Context<AppBindings>): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'
  );
}

export function userAgent(c: Context<AppBindings>): string {
  return (c.req.header('user-agent') ?? '').slice(0, 400);
}

export async function ipBucket(c: Context<AppBindings>): Promise<string> {
  return hashIp(clientIp(c), c.env.SESSION_SECRET ?? 'dev-pepper');
}

/**
 * CSRF defence-in-depth for cookie-authenticated, state-changing requests:
 *   1. SameSite=Lax cookies (see auth service),
 *   2. an Origin/Referer check,
 *   3. a per-session CSRF token supplied in `X-CSRF-Token`.
 * The session cookie is intentionally NOT set for cross-site requests and all
 * API mutation is JSON, which blocks simple form-based CSRF.
 */
export function assertSameOrigin(c: Context<AppBindings>): void {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  const origin = c.req.header('origin');
  const referer = c.req.header('referer');
  const expected = (c.env.APP_BASE_URL || '').replace(/\/$/, '');
  const candidate = origin ?? (referer ? new URL(referer).origin : null);

  if (!candidate) return; // non-browser client (curl, integration tests) - CSRF token still required

  // The request's own origin is always acceptable: a browser that sends an
  // Origin header equal to the host it contacted is same-origin by definition.
  // Deriving it from the incoming request (rather than only from configuration)
  // keeps the check correct behind proxies, on preview hostnames, and for
  // `wrangler dev`.
  const selfOrigin = new URL(c.req.url).origin;
  const forwardedHost = (c.req.header('host') ?? '').trim();
  const allowed = new Set([
    expected,
    selfOrigin,
    forwardedHost ? `${new URL(c.req.url).protocol}//${forwardedHost}` : '',
    'http://localhost:8787',
    'http://127.0.0.1:8787',
  ]);

  if (!allowed.has(candidate)) {
    throw ApiError.forbidden('Cross-origin request rejected.');
  }
}

export function assertCsrf(c: Context<AppBindings>, sessionCsrf: string | null): void {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const header = c.req.header('x-csrf-token');
  if (!sessionCsrf || !header || header !== sessionCsrf) {
    throw ApiError.forbidden('Missing or invalid CSRF token.');
  }
}

export function getSessionCookie(c: Context<AppBindings>): string | null {
  return getCookie(c, cookieName(c)) ?? null;
}

export function securityHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'SAMEORIGIN',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  };
}
