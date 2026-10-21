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
  disableTotp,
  enableTotp,
  hasAnyUserWithRole,
  consumeMagicLink,
  login,
  loginFederated,
  loginWithOtp,
  requestMagicLink,
  requestPasswordReset,
  resetPasswordWithToken,
  normaliseEmail,
  requestLoginOtp,
  revokeAllSessions,
  revokeSession,
  setupTotp,
  toAuthUser,
  updateProfile,
  verifyTwoFactor,
} from '../services/auth-service';
import { recordAudit } from '../lib/audit';
import { currentUser } from '../middleware/auth';
import { parseBody } from '../lib/validate';
import { newId, nowIso } from '../lib/ids';
import { loadPlatformSettings } from '../lib/settings';
import { resolveSession } from '../services/auth-service';
import { notify } from '../services/notification-service';
import { getSessionToken } from '../lib/http';

/**
 * The raw session token is only echoed back outside production. Embedded
 * sandbox previews drop the session cookie in the browser, so the SPA there
 * authenticates with `Authorization: Bearer <sessionToken>` instead.
 * Production keeps cookie-only delivery.
 */
function devSessionToken(c: { env: { APP_ENV?: string } }, token: string): string | undefined {
  return c.env.APP_ENV === 'production' ? undefined : token;
}

const router = new Hono<AppBindings>();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  /** Public handle — 3–24 chars, letters/numbers/dot/underscore. */
  username: z.string().trim().max(24).optional(),
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
    username: body.username ?? null,
    role,
  });

  const session = await login(
    c.env,
    { email: user.email, password: body.password },
    { ip: clientIp(c), userAgent: userAgent(c) },
  );
  if ('twoFactorRequired' in session) {
    throw ApiError.unauthenticated('Unexpected second-factor challenge for a new account.');
  }

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

  await notify(c.env, {
    userId: user.id,
    kind: 'SYSTEM',
    title: 'Welcome to AI Eo 👋',
    body: 'Start with a quick practice test to see where you stand, then let the study plan map the rest.',
    href: '/practice',
  });

  setSessionCookie(c, session.token, session.session.expiresAt);
  return c.json({ user: session.user, csrfToken: session.session.csrfToken, sessionToken: devSessionToken(c, session.token) }, 201);
});

router.post('/login', async (c) => {
  assertSameOrigin(c);
  // The field accepts either the email address or the username.
  const body = await parseBody(
    c,
    z.object({ email: z.string().trim().min(3).max(254), password: z.string().min(1).max(200) }),
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
  if ('twoFactorRequired' in result) {
    // No cookie yet — the authenticator step completes the sign-in.
    return c.json({ twoFactorRequired: true, ticket: result.ticket, expiresAt: result.expiresAt });
  }
  setSessionCookie(c, result.token, result.session.expiresAt);
  return c.json({ user: result.user, csrfToken: result.session.csrfToken, sessionToken: devSessionToken(c, result.token) });
});

// ---------------------------------------------------------------- 2FA & OTP

/** Active sign-in sessions of the current account (account management). */
router.get('/sessions', async (c) => {
  const user = currentUser(c);
  const currentId = c.get('session')?.id ?? null;
  const rows = await c.env.DB.prepare(
    `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY last_seen_at DESC
      LIMIT 30`,
  )
    .bind(user.id, nowIso())
    .all<{ id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string | null; user_agent: string | null }>();
  return c.json({
    sessions: rows.results.map((row) => ({
      sessionId: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      ip: row.ip,
      userAgent: row.user_agent,
      current: row.id === currentId,
    })),
  });
});

/** Revoke one session — the current one signs the browser out. */
router.post('/sessions/:sessionId/revoke', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const sessionId = c.req.param('sessionId');
  const result = await c.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), sessionId, user.id)
    .run();
  if (!result.meta.changes) throw ApiError.notFound('That session is not active.');
  if (sessionId === c.get('session')?.id) deleteCookie(c, c.env.SESSION_COOKIE_NAME || 'ielts_session', { path: '/' });
  return c.json({ ok: true, signedOutCurrent: sessionId === c.get('session')?.id });
});

/** Revoke every session except the one in this browser. */
router.post('/sessions/revoke-others', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const currentId = c.get('session')?.id ?? '';
  const result = await c.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), user.id, currentId)
    .run();
  return c.json({ ok: true, revoked: result.meta.changes ?? 0 });
});

router.get('/2fa/status', async (c) => {
  const user = currentUser(c);
  const row = await c.env.DB.prepare('SELECT totp_enabled, totp_secret FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ totp_enabled: number; totp_secret: string | null }>();
  return c.json({ enabled: row?.totp_enabled === 1, pending: Boolean(row?.totp_secret) });
});

router.post('/2fa/setup', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await setupTotp(c.env, user));
});

router.post('/2fa/enable', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ code: z.string().trim().min(6).max(8) }));
  return c.json(await enableTotp(c.env, user, body.code));
});

router.post('/2fa/disable', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ code: z.string().trim().max(8).default('') }));
  return c.json(await disableTotp(c.env, user, body.code));
});

router.post('/2fa/verify', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(
    c,
    z.object({ ticket: z.string().min(8).max(200), code: z.string().trim().min(6).max(16) }),
  );
  await enforceRateLimit(
    c.env,
    { bucket: `2fa:${clientIp(c)}`, windowSeconds: 900, limit: 20 },
    'Too many verification attempts. Please try again later.',
  );
  const result = await verifyTwoFactor(c.env, body, { ip: clientIp(c), userAgent: userAgent(c) });
  setSessionCookie(c, result.token, result.session.expiresAt);
  return c.json({ user: result.user, csrfToken: result.session.csrfToken, sessionToken: devSessionToken(c, result.token) });
});

router.post('/otp/request', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(c, z.object({ identifier: z.string().trim().min(3).max(254) }));
  await enforceRateLimit(
    c.env,
    { bucket: `otp-request:${clientIp(c)}`, windowSeconds: 900, limit: 10 },
    'Too many code requests. Please try again later.',
  );
  await enforceRateLimit(
    c.env,
    { bucket: `otp-request-account:${body.identifier}`, windowSeconds: 900, limit: 5 },
    'Too many code requests for this account. Please try again later.',
  );
  return c.json(await requestLoginOtp(c.env, body.identifier));
});

router.post('/otp/login', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(
    c,
    z.object({ identifier: z.string().trim().min(3).max(254), code: z.string().trim().min(4).max(16) }),
  );
  await enforceRateLimit(
    c.env,
    { bucket: `otp-login:${clientIp(c)}`, windowSeconds: 900, limit: 12 },
    'Too many sign-in attempts. Please try again later.',
  );
  const result = await loginWithOtp(c.env, body, { ip: clientIp(c), userAgent: userAgent(c) });
  if ('twoFactorRequired' in result) {
    return c.json({ twoFactorRequired: true, ticket: result.ticket, expiresAt: result.expiresAt });
  }
  setSessionCookie(c, result.token, result.session.expiresAt);
  return c.json({ user: result.user, csrfToken: result.session.csrfToken, sessionToken: devSessionToken(c, result.token) });
});

// ------------------------------------------------------------------- SSO

const SSO_PROVIDERS: Record<string, { label: string; clientIdEnv: string; clientSecretEnv: string; authUrl: string; tokenUrl: string; userUrl: string }> = {
  google: {
    label: 'Google',
    clientIdEnv: 'SSO_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'SSO_GOOGLE_CLIENT_SECRET',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
  microsoft: {
    label: 'Microsoft',
    clientIdEnv: 'SSO_MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'SSO_MICROSOFT_CLIENT_SECRET',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userUrl: 'https://graph.microsoft.com/oidc/userinfo',
  },
};

/** Starts an OIDC sign-in. Requires the provider credentials in env. */
router.get('/sso/:provider/start', async (c) => {
  const provider = SSO_PROVIDERS[c.req.param('provider')];
  if (!provider) throw ApiError.notFound('Unknown sign-in provider.');
  // `?link=1` connects the provider to the account that is already signed in.
  const linkMode = c.req.query('link') === '1';
  let linkUserId: string | null = null;
  if (linkMode) {
    const session = c.get('session');
    if (!session) throw ApiError.unauthenticated('Sign in first, then connect the provider.');
    linkUserId = session.userId;
  }
  const clientId = (c.env as unknown as Record<string, string | undefined>)[provider.clientIdEnv];
  if (!clientId) {
    throw new ApiError(
      'SSO_NOT_CONFIGURED',
      `${provider.label} sign-in is not configured on this platform yet. Ask an administrator to add ${provider.clientIdEnv}.`,
    );
  }
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/sso/${c.req.param('provider')}/callback`;
  const authUrl = new URL(provider.authUrl);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('prompt', 'select_account');
  if (linkUserId) {
    authUrl.searchParams.set('state', btoa(JSON.stringify({ link: linkUserId })));
  }
  return c.redirect(authUrl.toString());
});

/**
 * OIDC callback — exchanges the code and signs the matching account in.
 * Accounts are matched by email; first login through a provider still requires
 * the account to exist (teachers/admins create accounts on this platform).
 */
router.get('/sso/:provider/callback', async (c) => {
  const providerName = c.req.param('provider');
  const provider = SSO_PROVIDERS[providerName];
  if (!provider) throw ApiError.notFound('Unknown sign-in provider.');
  const clientId = (c.env as unknown as Record<string, string | undefined>)[provider.clientIdEnv];
  const clientSecret = (c.env as unknown as Record<string, string | undefined>)[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new ApiError('SSO_NOT_CONFIGURED', `${provider.label} sign-in is not configured on this platform yet.`);
  }
  const code = c.req.query('code');
  if (!code) throw ApiError.validation('The provider did not return a sign-in code.');
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/sso/${providerName}/callback`;

  const tokenResponse = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) throw ApiError.unauthenticated('Could not complete the provider sign-in.');
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) throw ApiError.unauthenticated('Could not complete the provider sign-in.');

  const userResponse = await fetch(provider.userUrl, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResponse.ok) throw ApiError.unauthenticated('Could not read your provider profile.');
  const profile = (await userResponse.json()) as { email?: string; name?: string; sub?: string };
  if (!profile.email) throw ApiError.unauthenticated('The provider account has no email address.');
  const subject = (profile.sub ?? '').trim() || profile.email;

  // Link mode: attach this provider identity to the signed-in account.
  const stateRaw = c.req.query('state');
  let linkUserId: string | null = null;
  if (stateRaw) {
    try {
      const state = JSON.parse(atob(stateRaw)) as { link?: string };
      linkUserId = typeof state.link === 'string' ? state.link : null;
    } catch {
      linkUserId = null;
    }
  }
  if (linkUserId) {
    const session = c.get('session');
    if (!session || session.userId !== linkUserId) {
      throw ApiError.unauthenticated('Sign in first, then connect the provider.');
    }
    const owned = await c.env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?')
      .bind(providerName, subject)
      .first<{ user_id: string }>();
    if (owned && owned.user_id !== linkUserId) {
      throw ApiError.forbidden(`That ${provider.label} account is already linked to a different user on this platform.`);
    }
    const timestamp = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO user_identities (id, user_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider, subject) DO UPDATE SET user_id = excluded.user_id, email = excluded.email`,
    )
      .bind(newId('uid'), linkUserId, providerName, subject, profile.email, timestamp)
      .run();
    return c.redirect(`/settings?linked=${encodeURIComponent(providerName)}`);
  }

  // Sign-in: a known identity wins; an email match links the identity too.
  const identity = await c.env.DB.prepare('SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?')
    .bind(providerName, subject)
    .first<{ user_id: string }>();
  if (identity) {
    const row = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
      .bind(identity.user_id)
      .first<{ email: string }>();
    if (row) {
      const result = await loginFederated(c.env, row.email, { ip: clientIp(c), userAgent: userAgent(c) });
      setSessionCookie(c, result.token, result.session.expiresAt);
      return c.redirect('/');
    }
  }

  try {
    const result = await loginFederated(c.env, profile.email, { ip: clientIp(c), userAgent: userAgent(c) });
    setSessionCookie(c, result.token, result.session.expiresAt);
    // Back-fill the link so the next sign-in works even if the email changes.
    try {
      await c.env.DB.prepare(
        `INSERT INTO user_identities (id, user_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, subject) DO NOTHING`,
      )
        .bind(newId('uid'), result.session.userId, providerName, subject, profile.email, nowIso())
        .run();
    } catch (linkError) {
      console.warn('sso_identity_backfill_failed', linkError instanceof Error ? linkError.message : linkError);
    }
    return c.redirect('/');
  } catch {
    throw ApiError.forbidden(
      'No platform account matches that provider email yet. Ask your teacher or administrator to invite you first.',
    );
  }
});

/** Which providers are linked to the signed-in account (settings screen). */
router.get('/identities', async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare('SELECT provider, email, created_at FROM user_identities WHERE user_id = ? ORDER BY provider')
    .bind(user.id)
    .all<{ provider: string; email: string | null; created_at: string }>();
  return c.json({ identities: rows.results ?? [] });
});

// --------------------------------------------------------- Email links

/** Sends a magic sign-in link. The response never discloses whether the account exists. */
router.post('/magic/request', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(c, z.object({ email: z.string().trim().min(3).max(254) }));
  await enforceRateLimit(
    c.env,
    { bucket: `magic-request:${clientIp(c)}`, windowSeconds: 900, limit: 10 },
    'Too many link requests. Please try again later.',
  );
  await enforceRateLimit(
    c.env,
    { bucket: `magic-account:${body.email.toLowerCase()}`, windowSeconds: 900, limit: 5 },
    'Too many link requests for this account. Please try again later.',
  );
  return c.json(await requestMagicLink(c.env, body.email));
});

/** Exchanges the emailed token for a session (or a 2FA challenge). */
router.post('/magic/consume', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(c, z.object({ token: z.string().trim().min(16).max(200) }));
  await enforceRateLimit(
    c.env,
    { bucket: `magic-consume:${clientIp(c)}`, windowSeconds: 900, limit: 20 },
    'Too many attempts. Please try again later.',
  );
  const result = await consumeMagicLink(c.env, body.token, { ip: clientIp(c), userAgent: userAgent(c) });
  if ('twoFactorRequired' in result) {
    return c.json({ twoFactorRequired: true, ticket: result.ticket, expiresAt: result.expiresAt });
  }
  setSessionCookie(c, result.token, result.session.expiresAt);
  return c.json({ user: result.user, csrfToken: result.session.csrfToken, sessionToken: devSessionToken(c, result.token) });
});

/** Starts a password reset. Always `{ sent: true }`. */
router.post('/password/forgot', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(c, z.object({ email: z.string().trim().min(3).max(254) }));
  await enforceRateLimit(
    c.env,
    { bucket: `forgot:${clientIp(c)}`, windowSeconds: 900, limit: 8 },
    'Too many reset requests. Please try again later.',
  );
  await enforceRateLimit(
    c.env,
    { bucket: `forgot-account:${body.email.toLowerCase()}`, windowSeconds: 900, limit: 5 },
    'Too many reset requests for this account. Please try again later.',
  );
  return c.json(await requestPasswordReset(c.env, body.email));
});

/** Completes a reset; every existing session is revoked. */
router.post('/password/reset', async (c) => {
  assertSameOrigin(c);
  const body = await parseBody(
    c,
    z.object({ token: z.string().trim().min(16).max(200), password: z.string().min(1).max(200) }),
  );
  await enforceRateLimit(
    c.env,
    { bucket: `reset:${clientIp(c)}`, windowSeconds: 900, limit: 12 },
    'Too many attempts. Please try again later.',
  );
  const result = await resetPasswordWithToken(c.env, body.token, body.password);
  return c.json({ ok: true, email: result.email });
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

router.post('/heartbeat', async (c) => {
  assertSameOrigin(c);
  currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json({ ok: true });
});

router.get('/me', async (c) => {
  const token = getSessionToken(c);
  if (!token) return c.json({ user: null, csrfToken: null });
  const resolved = await resolveSession(c.env, token);
  if (!resolved) return c.json({ user: null, csrfToken: null });
  return c.json({ user: resolved.user, csrfToken: resolved.session.csrfToken, sessionToken: devSessionToken(c, token) });
});

router.patch('/profile', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      displayName: z.string().trim().min(1).max(120).optional(),
      username: z
        .string()
        .trim()
        .min(3)
        .max(24)
        .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore.')
        .optional(),
      targetBand: z.number().min(0).max(9).nullable().optional(),
      timezone: z.string().trim().max(64).nullable().optional(),
      bio: z.string().trim().max(600).optional(),
      links: z
        .array(z.object({ label: z.string().trim().min(1).max(32), url: z.string().trim().url().max(300) }))
        .max(5)
        .optional(),
    }),
  );
  if (body.username !== undefined && body.username.toLowerCase() !== (user.username ?? '').toLowerCase()) {
    const clash = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
      .bind(body.username, user.id)
      .first<{ id: string }>();
    if (clash) throw ApiError.validation('That username is already taken.');
    await c.env.DB.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?')
      .bind(body.username, nowIso(), user.id)
      .run();
  }
  await updateProfile(c.env, user.id, body);
  const updated = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.role, u.status, u.created_at, u.last_login_at, p.display_name, p.avatar_updated_at
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      username: string | null;
      role: 'STUDENT' | 'TEACHER' | 'ADMIN' | 'MENTOR';
      status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
      created_at: string;
      last_login_at: string | null;
      display_name: string | null;
      avatar_updated_at: string | null;
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
  // Derive `Secure` from the protocol the browser actually used, honouring the
  // proxy's X-Forwarded-Proto so the attribute is correct behind the sandbox
  // preview proxy and on plain-HTTP local development alike.
  const requestUrl = new URL(c.req.url);
  const forwardedProto = (c.req.header('x-forwarded-proto') ?? '').split(',')[0]?.trim().toLowerCase();
  const secure = requestUrl.protocol === 'https:' || forwardedProto === 'https';

  // In development the app can be embedded cross-site (sandbox preview iframe).
  // A SameSite=Lax cookie is never sent from that context, which breaks the
  // session after login. SameSite=None is only used on secure development
  // connections; production keeps the stricter Lax.
  const sameSite = secure && c.env.APP_ENV === 'development' ? 'None' : 'Lax';

  setCookie(c, c.env.SESSION_COOKIE_NAME || 'ielts_session', token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite,
    expires: new Date(expiresAt),
  });
  for (const [key, value] of Object.entries(securityHeaders())) {
    c.header(key, value);
  }
}

export default router;
