import { Hono, type Context } from 'hono';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import type { AuthUser } from '../lib/auth-types';
import { resolveAssetUrl } from '../services/media-service';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);

interface AssetRow {
  id: string;
  kind: string;
  storage_kind: string;
  external_url: string | null;
  r2_key: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  visibility: string;
  test_version_id: string | null;
  uploaded_by: string | null;
}

/**
 * Resolves an asset to a deliverable URL after an ownership/authorization check.
 *
 * V1 stores media as external HTTPS URLs (or bundled demo files), so this route
 * verifies access and then redirects. Assets are never public: listening audio
 * and chart images are reachable only by users entitled to the test version, and
 * private import sources stay admin-only.
 */
router.get('/:assetId', async (c) => {
  const user = currentUser(c);
  const asset = await c.env.DB.prepare(
    `SELECT id, kind, storage_kind, external_url, r2_key, filename, mime, size_bytes, visibility,
            test_version_id, uploaded_by
       FROM assets WHERE id = ?`,
  )
    .bind(c.req.param('assetId'))
    .first<AssetRow>();

  if (!asset) throw ApiError.notFound('File not found.');

  const allowed = await canAccessAsset(c, user, asset);
  if (!allowed) throw ApiError.forbidden('You are not authorized to access this file.');

  const url = resolveAssetUrl(asset);
  if (!url) {
    throw new ApiError(
      'NOT_FOUND',
      'This asset has no media URL yet. An administrator can add an external HTTPS link for it.',
    );
  }

  if (url.startsWith('/')) return c.redirect(url, 302);
  return c.redirect(url, 302);
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
