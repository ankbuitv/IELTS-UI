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
import { newId, nowIso } from '../lib/ids';
import { base64ToBytes, deleteBlob, getBlob, putBlob } from '../services/blob-store';
import { avatarUrlFor } from '../services/auth-service';
import { MAX_AVATAR_BYTES, sniffAvatarBytes, validateAvatarFilename, validateAvatarMime } from '../../shared/avatar';
import { resolveSession } from '../services/auth-service';
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
  return c.json({ user: session.user, csrfToken: session.session.csrfToken, sessionToken: devSessionToken(c, session.token) }, 201);
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
  return c.json({ user: result.user, csrfToken: result.session.csrfToken, sessionToken: devSessionToken(c, result.token) });
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
      targetBand: z.number().min(0).max(9).nullable().optional(),
      timezone: z.string().trim().max(64).nullable().optional(),
    }),
  );
  await updateProfile(c.env, user.id, body);
  const updated = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_login_at, p.display_name, p.avatar_asset_id
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
      avatar_asset_id: string | null;
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


router.post('/avatar', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      filename: z.string().min(1).max(200),
      mime: z.string().max(100).optional(),
      dataBase64: z.string().min(8).max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 2048),
    }),
  );

  const nameCheck = validateAvatarFilename(body.filename);
  if (!nameCheck.ok) throw ApiError.validation(nameCheck.reason);

  const mimeCheck = validateAvatarMime(body.mime, nameCheck.extension);
  if (!mimeCheck.ok) throw ApiError.validation(mimeCheck.reason);

  const payload = body.dataBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) {
    throw ApiError.validation('Invalid image encoding.');
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(payload);
  } catch {
    throw ApiError.validation('Invalid image data.');
  }

  const sniff = sniffAvatarBytes(bytes, nameCheck.extension);
  if (!sniff.ok) throw ApiError.validation(sniff.reason);

  const prev = await c.env.DB.prepare('SELECT avatar_asset_id FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ avatar_asset_id: string | null }>();

  const assetId = newId('ast');
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO assets (id, kind, storage_kind, external_url, filename, mime, size_bytes, alt_text,
                         visibility, uploaded_by, created_at, updated_at)
     VALUES (?, 'IMAGE', 'OBJECT_STORAGE', NULL, ?, ?, ?, 'Avatar', 'PRIVATE', ?, ?, ?)`,
  )
    .bind(assetId, nameCheck.sanitizedFilename, sniff.mime, bytes.byteLength, user.id, timestamp, timestamp)
    .run();

  await putBlob(c.env, 'asset_blobs', 'asset_id', assetId, payload, {
    mime: sniff.mime,
    bytes: bytes.byteLength,
  });

  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id, display_name, avatar_asset_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET avatar_asset_id = excluded.avatar_asset_id, updated_at = excluded.updated_at`,
  )
    .bind(user.id, user.displayName, assetId, timestamp, timestamp)
    .run();

  const previousId = (prev?.avatar_asset_id ?? '').trim();
  if (previousId && previousId !== assetId) {
    await deleteBlob(c.env, 'asset_blobs', 'asset_id', previousId);
    await c.env.DB.prepare('DELETE FROM assets WHERE id = ? AND uploaded_by = ?').bind(previousId, user.id).run();
  }

  const avatarUrl = avatarUrlFor(user.id, assetId);
  return c.json({ avatarUrl, user: { ...user, avatarUrl } });
});

router.delete('/avatar', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);

  const prev = await c.env.DB.prepare('SELECT avatar_asset_id FROM user_profiles WHERE user_id = ?')
    .bind(user.id)
    .first<{ avatar_asset_id: string | null }>();
  const previousId = (prev?.avatar_asset_id ?? '').trim();

  await c.env.DB.prepare('UPDATE user_profiles SET avatar_asset_id = ?, updated_at = ? WHERE user_id = ?')
    .bind('', nowIso(), user.id)
    .run();

  if (previousId) {
    await deleteBlob(c.env, 'asset_blobs', 'asset_id', previousId);
    await c.env.DB.prepare('DELETE FROM assets WHERE id = ? AND uploaded_by = ?').bind(previousId, user.id).run();
  }

  return c.json({ avatarUrl: null, user: { ...user, avatarUrl: null } });
});

router.get('/avatar/:userId', async (c) => {
  const targetUserId = c.req.param('userId');
  const row = await c.env.DB.prepare(
    `SELECT p.avatar_asset_id AS asset_id, a.mime AS mime
       FROM user_profiles p
       JOIN assets a ON a.id = p.avatar_asset_id
      WHERE p.user_id = ? AND p.avatar_asset_id != ''`,
  )
    .bind(targetUserId)
    .first<{ asset_id: string; mime: string }>();

  if (!row) throw ApiError.notFound('Avatar not found.');
  const stored = await getBlob(c.env, 'asset_blobs', 'asset_id', row.asset_id);
  if (!stored) throw ApiError.notFound('Avatar not found.');

  const bytes = base64ToBytes(stored.base64);
  const mime = row.mime || stored.mime || 'image/png';
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': mime,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      // Prevents any script execution if a user opens an SVG avatar URL directly.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
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
