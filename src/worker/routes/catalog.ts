import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import { loadCandidateTest } from '../services/content-service';
import { verifyAndUnlock } from '../services/access-code-service';
import { loadScoringProfile } from '../services/marking-service';
import { estimateBand } from '../../shared/scoring';
import { buildStructureSummary, type TestStructureSummary } from '../../shared/sections';
import type { TestType } from '../../shared/types';

const router = new Hono<AppBindings>();

/** SQL expression: the effective structural type of a section row. */
const EFFECTIVE_SECTION_TYPE = `COALESCE(s.type, CASE s.skill WHEN 'READING' THEN 'READING_PASSAGE' WHEN 'LISTENING' THEN 'LISTENING_PART' ELSE 'WRITING_TASK' END)`;

interface SectionCounts {
  passages: number;
  parts: number;
  tasks: number;
}

async function countSectionsByVersionIds(db: D1Database, versionIds: string[]): Promise<Map<string, SectionCounts>> {
  const byVersion = new Map<string, SectionCounts>();
  if (versionIds.length === 0) return byVersion;
  const rows = await db.prepare(
    `SELECT s.test_version_id AS version_id,
            SUM(CASE WHEN ${EFFECTIVE_SECTION_TYPE} = 'READING_PASSAGE' THEN 1 ELSE 0 END) AS passages,
            SUM(CASE WHEN ${EFFECTIVE_SECTION_TYPE} = 'LISTENING_PART' THEN 1 ELSE 0 END) AS parts,
            SUM(CASE WHEN ${EFFECTIVE_SECTION_TYPE} = 'WRITING_TASK' THEN 1 ELSE 0 END) AS tasks
       FROM sections s
      WHERE s.test_version_id IN (${versionIds.map(() => '?').join(',')})
      GROUP BY s.test_version_id`,
  )
    .bind(...versionIds)
    .all<{ version_id: string; passages: number | null; parts: number | null; tasks: number | null }>();
  for (const row of rows.results) {
    byVersion.set(row.version_id, { passages: row.passages ?? 0, parts: row.parts ?? 0, tasks: row.tasks ?? 0 });
  }
  return byVersion;
}

function summarise(row: {
  type: TestType;
  total_questions: number;
  duration_seconds: number | null;
  own?: SectionCounts;
  components?: Array<{ counts: SectionCounts; duration: number }>;
}): TestStructureSummary {
  let passages = row.own?.passages ?? 0;
  let parts = row.own?.parts ?? 0;
  let tasks = row.own?.tasks ?? 0;
  let durationSeconds = row.duration_seconds;
  if (row.type === 'FULL_MOCK' && row.components && row.components.length > 0) {
    for (const component of row.components) {
      passages += component.counts.passages;
      parts += component.counts.parts;
      tasks += component.counts.tasks;
    }
    if (durationSeconds === null) {
      durationSeconds = row.components.reduce((total, component) => total + component.duration, 0);
    }
  }
  return buildStructureSummary({
    passages,
    parts,
    tasks,
    questions: row.total_questions,
    durationSeconds,
  });
}

/**
 * Published-test catalogue. Candidate-safe: only summaries are returned, never
 * question content or answer material.
 */
router.get('/tests', requireAuth, async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.type, t.summary, t.content_origin, t.updated_at,
            t.access_code_hash IS NOT NULL AS requires_code,
            v.id AS version_id, v.version_number, v.total_questions, v.duration_seconds, v.is_complete_test,
            (SELECT COUNT(*) FROM mock_components mc WHERE mc.mock_version_id = v.id) AS component_count,
            (SELECT COUNT(*) FROM test_unlocks u WHERE u.test_id = t.id AND u.user_id = ?) AS unlocked
       FROM tests t
       JOIN test_versions v ON v.id = t.current_version_id
      WHERE t.status = 'PUBLISHED'
      ORDER BY t.type, t.title`,
  )
    .bind(user.id)
    .all<{
      id: string;
      slug: string;
      title: string;
      type: TestType;
      summary: string;
      content_origin: string;
      updated_at: string;
      requires_code: number;
      version_id: string;
      version_number: number;
      total_questions: number;
      duration_seconds: number | null;
      is_complete_test: number;
      component_count: number;
      unlocked: number;
    }>();

  // 42: structure lines on the library cards come from the real section data.
  const ownCounts = await countSectionsByVersionIds(
    c.env.DB,
    rows.results.filter((row) => row.type !== 'FULL_MOCK').map((row) => row.version_id),
  );
  const mockVersionIds = rows.results.filter((row) => row.type === 'FULL_MOCK').map((row) => row.version_id);
  const mockComponents = new Map<string, Array<{ counts: SectionCounts; duration: number }>>();
  if (mockVersionIds.length > 0) {
    const componentRows = await c.env.DB.prepare(
      `SELECT mc.mock_version_id, mc.test_version_id, mc.duration_seconds
         FROM mock_components mc
        WHERE mc.mock_version_id IN (${mockVersionIds.map(() => '?').join(',')})
        ORDER BY mc.mock_version_id, mc.order_index`,
    )
      .bind(...mockVersionIds)
      .all<{ mock_version_id: string; test_version_id: string; duration_seconds: number }>();
    const counts = await countSectionsByVersionIds(c.env.DB, [...new Set(componentRows.results.map((row) => row.test_version_id))]);
    for (const row of componentRows.results) {
      const list = mockComponents.get(row.mock_version_id) ?? [];
      mockComponents.set(row.mock_version_id, [
        ...list,
        { counts: counts.get(row.test_version_id) ?? { passages: 0, parts: 0, tasks: 0 }, duration: row.duration_seconds ?? 0 },
      ]);
    }
  }

  // Staff bypass access codes, so the client never prompts them.
  const staffBypass = user.role !== 'STUDENT';
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
      requiresAccessCode: row.requires_code === 1,
      unlocked: staffBypass || row.requires_code !== 1 || row.unlocked === 1,
      structure: summarise({
        type: row.type,
        total_questions: row.total_questions,
        duration_seconds: row.duration_seconds,
        own: ownCounts.get(row.version_id),
        components: mockComponents.get(row.version_id),
      }),
    })),
  });
});

/**
 * Unlock a code-protected test without starting an attempt. Students enter
 * the code once; later practice starts and previews reuse the unlock row.
 */
router.post('/tests/:testId/unlock', requireAuth, async (c) => {
  assertSameOrigin(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const user = currentUser(c);
  const body = await parseBody(c, z.object({ accessCode: z.string().trim().min(1).max(64) }));

  const test = await c.env.DB.prepare('SELECT id, status FROM tests WHERE id = ?')
    .bind(c.req.param('testId'))
    .first<{ id: string; status: string }>();
  if (!test) throw ApiError.notFound('Test not found.');
  if (user.role === 'STUDENT' && test.status !== 'PUBLISHED') {
    throw ApiError.forbidden('This test is not published.');
  }

  await verifyAndUnlock(c.env, user, test.id, body.accessCode);
  return c.json({ ok: true, unlocked: true });
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
  // Code-protected tests hide their structure until the student unlocks them.
  if (!isStaff) {
    await verifyAndUnlock(c.env, user, test.id, undefined);
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
