import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp, securityHeaders, userAgent } from '../lib/http';
import { enforceRateLimit } from '../lib/rate-limit';
import {
  changePassword,
  createUser,
  hasAnyUserWithRole,
  login,
  normaliseEmail,
  revokeAllSessions,
  revokeSession,
  toAuthUser,
  updateProfile,
} from '../services/auth-service';
import { recordAudit } from '../lib/audit';
import { currentUser } from '../middleware/auth';
import { parseBody } from '../lib/validate';
import { loadPlatformSettings } from '../lib/settings';
import { resolveSession } from '../services/auth-service';
import { getSessionCookie } from '../lib/http';

const router = new Hono<AppBindings>();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  /** Only honoured when the platform has no administrator yet (bootstrap). */
  bootstrapAdmin: z.boolean().optional(),
});

router.get('/status', async (c) => {
  const adminExists = await hasAnyUserWithRole(c.env, 'ADMIN');
  const settings = await loadPlatformSettings(c.env);
  return c.json({
    adminConfigured: adminExists,
    aiImportAvailable: Boolean(c.env.OPENAI_API_KEY),
    environment: c.env.APP_ENV,
    registrationEnabled: settings.registrationEnabled,
    integrityNotice: settings.integrityNotice,
  });
});

router.post('/register', async (c) => {
  assertSameOrigin(c);
  await enforceRateLimit(
    c.env,
    { bucket: `register:${clientIp(c)}`, windowSeconds: 900, limit: 20 },
    'Too many registration attempts. Please try again later.',
  );

  const body = await parseBody(c, registerSchema);
  const adminExists = await hasAnyUserWithRole(c.env, 'ADMIN');

  if (body.bootstrapAdmin && adminExists) {
    throw ApiError.forbidden('An administrator already exists for this platform.');
  }

  // Self-service registration can be switched off by an administrator. The
  // one-time bootstrap administrator is exempt so a platform can never lock
  // itself out of its own settings.
  const settings = await loadPlatformSettings(c.env);
  if (!settings.registrationEnabled && !(body.bootstrapAdmin && !adminExists)) {
    throw ApiError.forbidden('Self-service registration is disabled on this platform. Ask an administrator to create your account.');
  }

  // Public sign-up always creates STUDENT accounts, except for the one-time
  // bootstrap administrator when the platform has no admin yet.
  const role = body.bootstrapAdmin && !adminExists ? 'ADMIN' : 'STUDENT';

  const user = await createUser(c.env, {
    email: normaliseEmail(body.email),
    password: body.password,
    displayName: body.displayName,
    role,
  });

  const session = await login(
    c.env,
    { email: user.email, password: body.password },
    { ip: clientIp(c), userAgent: userAgent(c) },
  );

  if (role === 'ADMIN') {
    await recordAudit(c.env, {
      actorUserId: user.id,
      action: 'AUTH_BOOTSTRAP_ADMIN',
      entityType: 'user',
      entityId: user.id,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
  }

  setSessionCookie(c, session.token, session.session.expiresAt);
  return c.json({ user: session.user, csrfToken: session.session.csrfToken }, 201);
});

router.post('/login', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(
    c,
    z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) }),
  );

  await enforceRateLimit(
    c.env,
    { bucket: `login:${clientIp(c)}`, windowSeconds: 900, limit: Number(c.env.LOGIN_RATE_LIMIT_PER_15MIN || 10) },
    'Too many sign-in attempts from this address. Please try again later.',
  );
  await enforceRateLimit(
    c.env,
    { bucket: `login-account:${body.email}`, windowSeconds: 900, limit: 12 },
    'Too many sign-in attempts for this account. Please try again later.',
  );

  const result = await login(c.env, body, { ip: clientIp(c), userAgent: userAgent(c) });
  setSessionCookie(c, result.token, result.session.expiresAt);
  return c.json({ user: result.user, csrfToken: result.session.csrfToken });
});

router.post('/logout', async (c) => {
  assertSameOrigin(c);
  const session = c.get('session');
  if (session) {
    assertCsrf(c, session.csrfToken);
    await revokeSession(c.env, session.id);
  }
  deleteCookie(c, c.env.SESSION_COOKIE_NAME || 'ielts_session', { path: '/' });
  return c.json({ ok: true });
});

router.get('/me', async (c) => {
  const token = getSessionCookie(c);
  if (!token) return c.json({ user: null, csrfToken: null });
  const resolved = await resolveSession(c.env, token);
  if (!resolved) return c.json({ user: null, csrfToken: null });
  return c.json({ user: resolved.user, csrfToken: resolved.session.csrfToken });
});

router.patch('/profile', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      displayName: z.string().trim().min(1).max(120).optional(),
      targetBand: z.number().min(0).max(9).nullable().optional(),
      timezone: z.string().trim().max(64).nullable().optional(),
    }),
  );
  await updateProfile(c.env, user.id, body);
  const updated = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_login_at, p.display_name
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      role: 'STUDENT' | 'TEACHER' | 'ADMIN';
      status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
      created_at: string;
      last_login_at: string | null;
      display_name: string | null;
    }>();
  return c.json({
    user: updated
      ? toAuthUser({
          ...updated,
          password_hash: null,
          password_salt: null,
          password_iterations: null,
          password_algo: null,
          failed_login_count: 0,
          locked_until: null,
        })
      : user,
  });
});

router.post('/password', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }),
  );
  await changePassword(c.env, user.id, body.currentPassword, body.newPassword);
  await revokeAllSessions(c.env, user.id);
  deleteCookie(c, c.env.SESSION_COOKIE_NAME || 'ielts_session', { path: '/' });
  return c.json({ ok: true, message: 'Password changed. Please sign in again.' });
});

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string, expiresAt: string) {
  const secure = (c.env.APP_BASE_URL || '').startsWith('https://');
  setCookie(c, c.env.SESSION_COOKIE_NAME || 'ielts_session', token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    expires: new Date(expiresAt),
  });
  for (const [key, value] of Object.entries(securityHeaders())) {
    c.header(key, value);
  }
}

export default router;
