/**
 * Profile pictures.
 *
 * An avatar is stored as a chunked base64 blob in D1 (`profile_avatars`, the
 * same pattern as speaking recordings) and served back from
 * `GET /api/files/avatar/:userId`. The user profile row carries
 * `avatar_updated_at`, which becomes the `?v=` cache-buster in the URL every
 * client component uses.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { currentUser, requireAuth } from '../middleware/auth';
import { avatarUrlFor } from '../lib/auth-types';
import { deleteBlob, putBlob } from '../services/blob-store';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** ~2 MB of base64 (~1.5 MB of image) keeps the avatar cheap to serve from D1. */
const MAX_BASE64 = 2_800_000;

router.post('/avatar', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ mime: z.string().min(7).max(64), dataBase64: z.string().min(8).max(MAX_BASE64) }));

  const mime = body.mime.toLowerCase().split(';')[0]!.trim();
  if (!ALLOWED_MIME[mime]) {
    throw ApiError.validation('Use a PNG, JPEG, WebP or GIF image.');
  }
  const base64 = body.dataBase64.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
  if (base64.length < 8 || base64.length > MAX_BASE64) {
    throw ApiError.validation('That image is too large — keep avatars under 2 MB.');
  }
  // Cheap signature sniffing so a renamed file cannot smuggle other content.
  const head = atob(base64.slice(0, 24));
  const isImage =
    head.startsWith('\x89PNG') ||
    head.startsWith('\xff\xd8\xff') ||
    head.startsWith('GIF8') ||
    head.slice(0, 4) === 'RIFF';
  if (!isImage) throw ApiError.validation('That file does not look like an image.');

  await putBlob(c.env, 'profile_avatars', 'user_id', user.id, base64, { mime });
  const timestamp = nowIso();
  // Upsert: a user without a profile row would silently lose the avatar on
  // reload because the plain UPDATE would match zero rows.
  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id, display_name, avatar_updated_at, avatar_mime, created_at, updated_at)
     VALUES (?, '', ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET avatar_updated_at = excluded.avatar_updated_at, avatar_mime = excluded.avatar_mime, updated_at = excluded.updated_at`,
  )
    .bind(user.id, timestamp, mime, timestamp, timestamp)
    .run();

  return c.json({ ok: true, avatarUrl: avatarUrlFor(user.id, timestamp) });
});

router.delete('/avatar', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await deleteBlob(c.env, 'profile_avatars', 'user_id', user.id);
  await c.env.DB.prepare(
    `INSERT INTO user_profiles (user_id, display_name, created_at, updated_at) VALUES (?, '', ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET avatar_updated_at = NULL, avatar_mime = NULL, updated_at = excluded.updated_at`,
  )
    .bind(nowIso(), user.id)
    .run();
  return c.json({ ok: true, avatarUrl: null });
});

export default router;
