import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { loadCandidateTest } from '../services/content-service';
import { loadScoringProfile } from '../services/marking-service';
import { estimateBand } from '../../shared/scoring';
import type { TestType } from '../../shared/types';

const router = new Hono<AppBindings>();

/**
 * Published-test catalogue. Candidate-safe: only summaries are returned, never
 * question content or answer material.
 */
router.get('/tests', requireAuth, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.type, t.summary, t.content_origin, t.updated_at,
            v.id AS version_id, v.version_number, v.total_questions, v.duration_seconds, v.is_complete_test,
            (SELECT COUNT(*) FROM mock_components mc WHERE mc.mock_version_id = v.id) AS component_count
       FROM tests t
       JOIN test_versions v ON v.id = t.current_version_id
      WHERE t.status = 'PUBLISHED'
      ORDER BY t.type, t.title`,
  ).all<{
    id: string;
    slug: string;
    title: string;
    type: TestType;
    summary: string;
    content_origin: string;
    updated_at: string;
    version_id: string;
    version_number: number;
    total_questions: number;
    duration_seconds: number | null;
    is_complete_test: number;
    component_count: number;
  }>();

  return c.json({
    tests: rows.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      type: row.type,
      summary: row.summary,
      contentOrigin: row.content_origin,
      updatedAt: row.updated_at,
      versionId: row.version_id,
      versionNumber: row.version_number,
      totalQuestions: row.total_questions,
      durationSeconds: row.duration_seconds,
      isCompleteTest: row.is_complete_test === 1,
      mockComponentCount: row.component_count,
    })),
  });
});

/**
 * Structure preview. Used by the admin "Preview as candidate" action and by
 * candidates who are about to start a published test. The payload is the same
 * candidate-safe serializer used during an attempt - answer keys are never
 * selected from the database on this path.
 */
router.get('/tests/:testId/preview', requireAuth, async (c) => {
  const testId = c.req.param('testId');
  const requestedVersion = new URL(c.req.url).searchParams.get('versionId');

  const test = await c.env.DB.prepare('SELECT id, status, current_version_id, type FROM tests WHERE id = ?')
    .bind(testId)
    .first<{ id: string; status: string; current_version_id: string | null; type: TestType }>();
  if (!test) throw ApiError.notFound('Test not found.');

  const user = c.get('user')!;
  const isStaff = user.role === 'ADMIN' || user.role === 'TEACHER';
  if (!isStaff && test.status !== 'PUBLISHED') {
    throw ApiError.forbidden('This test is not published.');
  }

  const versionId = requestedVersion ?? test.current_version_id;
  if (!versionId) throw ApiError.notFound('This test has no version yet.');

  if (requestedVersion && !isStaff) {
    const published = await c.env.DB.prepare('SELECT status FROM test_versions WHERE id = ?')
      .bind(requestedVersion)
      .first<{ status: string }>();
    if (published?.status !== 'PUBLISHED') throw ApiError.forbidden('That version is not published.');
  }

  const { payload, version } = await loadCandidateTest(c.env, versionId);

  const profile = version.scoring_profile_id ? await loadScoringProfile(c.env, version.scoring_profile_id) : null;
  const readiness = {
    scoringProfileConfigured: Boolean(profile),
    bandExample: estimateBand({
      profile,
      skill: test.type === 'LISTENING' ? 'LISTENING' : 'READING',
      rawScore: payload.totalQuestions,
      totalQuestions: payload.totalQuestions,
      isCompleteTest: payload.isCompleteTest,
    }),
  };

  return c.json({ preview: true, test: payload, readiness });
});

export default router;
