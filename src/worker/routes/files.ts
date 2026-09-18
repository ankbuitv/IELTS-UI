import { Hono, type Context } from 'hono';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import type { AuthUser } from '../lib/auth-types';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);

interface AssetRow {
  id: string;
  kind: string;
  r2_key: string;
  filename: string;
  mime: string;
  size_bytes: number;
  visibility: string;
  test_version_id: string | null;
  uploaded_by: string | null;
}

/**
 * Streams an asset from R2 after an ownership/authorization check.
 *
 * Assets are never public. Listening audio and chart images are reachable only
 * by users entitled to the test version; private import sources stay admin-only.
 * Range requests are forwarded to R2 so audio seeking works in the exam player.
 */
router.get('/:assetId', async (c) => {
  const user = currentUser(c);
  const asset = await c.env.DB.prepare(
    'SELECT id, kind, r2_key, filename, mime, size_bytes, visibility, test_version_id, uploaded_by FROM assets WHERE id = ?',
  )
    .bind(c.req.param('assetId'))
    .first<AssetRow>();

  if (!asset) throw ApiError.notFound('File not found.');

  const allowed = await canAccessAsset(c, user, asset);
  if (!allowed) throw ApiError.forbidden('You are not authorized to access this file.');

  const object = await c.env.CONTENT_BUCKET.get(asset.r2_key, { range: c.req.raw.headers });
  if (!object) throw ApiError.notFound('The stored file is missing.');

  const headers = new Headers();
  headers.set('content-type', asset.mime || 'application/octet-stream');
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=300');
  headers.set(
    'content-disposition',
    `${asset.kind === 'AUDIO' || asset.kind === 'IMAGE' ? 'inline' : 'attachment'}; filename="${asset.filename.replace(/"/g, '')}"`,
  );

  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && typeof range.offset === 'number') {
    const start = range.offset;
    const length = range.length ?? asset.size_bytes - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${asset.size_bytes}`);
    headers.set('content-length', String(length));
    return new Response(object.body as unknown as ReadableStream, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body as unknown as ReadableStream, { status: 200, headers });
});

async function canAccessAsset(
  c: Context<AppBindings>,
  user: AuthUser,
  asset: AssetRow,
): Promise<boolean> {
  if (user.role === 'ADMIN') return true;
  if (asset.uploaded_by === user.id && asset.visibility === 'PRIVATE') return true;

  if (!asset.test_version_id) return false;

  const version = await c.env.DB.prepare('SELECT id, status, test_id, created_by FROM test_versions WHERE id = ?')
    .bind(asset.test_version_id)
    .first<{ id: string; status: string; test_id: string; created_by: string | null }>();
  if (!version) return false;

  if (user.role === 'TEACHER') {
    if (version.status === 'PUBLISHED' || version.status === 'ARCHIVED') return true;
    if (version.created_by === user.id) return true;
    const ownAssignment = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM assignments a JOIN classrooms cl ON cl.id = a.classroom_id
        WHERE a.test_version_id = ? AND (a.teacher_id = ? OR cl.teacher_id = ?) LIMIT 1`,
    )
      .bind(asset.test_version_id, user.id, user.id)
      .first<{ ok: number }>();
    return Boolean(ownAssignment);
  }

  // Students: the file must belong to a version they are actually taking or
  // assigned, never merely to some published test.
  if (asset.visibility !== 'ATTEMPT') return false;

  const attempt = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM attempts WHERE user_id = ? AND (test_version_id = ?
        OR id IN (SELECT attempt_id FROM attempt_skill_sessions WHERE test_version_id = ?))
      LIMIT 1`,
  )
    .bind(user.id, asset.test_version_id, asset.test_version_id)
    .first<{ ok: number }>();
  if (attempt) return true;

  const assigned = await c.env.DB.prepare(
    `SELECT 1 AS ok
       FROM assignments a
       JOIN classroom_members m ON m.classroom_id = a.classroom_id AND m.user_id = ? AND m.status = 'ACTIVE'
      WHERE a.test_version_id = ? AND a.status IN ('ACTIVE','CLOSED')
      LIMIT 1`,
  )
    .bind(user.id, asset.test_version_id)
    .first<{ ok: number }>();

  return Boolean(assigned);
}

export default router;
