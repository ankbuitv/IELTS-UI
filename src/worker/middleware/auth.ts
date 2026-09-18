import { createMiddleware } from 'hono/factory';
import type { AppBindings } from '../env';
import { getSessionToken } from '../lib/http';
import { resolveSession, touchSession } from '../services/auth-service';
import { ApiError } from '../lib/errors';
import type { Role } from '../../shared/types';

/** Resolves the session (Bearer token or cookie) into `c.get('user')`. Never throws. */
export const attachAuth = createMiddleware<AppBindings>(async (c, next) => {
  const token = getSessionToken(c);
  if (token) {
    try {
      const resolved = await resolveSession(c.env, token);
      if (resolved) {
        c.set('user', resolved.user);
        c.set('session', resolved.session);
        // Keep an idle-timeout style activity marker without blocking the response.
        c.executionCtx?.waitUntil?.(touchSession(c.env, resolved.session.id));
      }
    } catch (error) {
      console.error('session_resolve_failed', (error as Error).message);
    }
  }
  await next();
});

export const requireAuth = createMiddleware<AppBindings>(async (c, next) => {
  const user = c.get('user');
  if (!user) throw ApiError.unauthenticated();
  await next();
});

export function requireRole(...roles: Role[]) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const user = c.get('user');
    if (!user) throw ApiError.unauthenticated();
    if (!roles.includes(user.role)) throw ApiError.forbidden('Your role does not permit this action.');
    await next();
  });
}

/** Authorization must be enforced server-side; route handlers use this helper. */
export function currentUser(c: { get: (key: 'user') => import('../lib/auth-types').AuthUser | null }) {
  const user = c.get('user');
  if (!user) throw ApiError.unauthenticated();
  return user;
}
