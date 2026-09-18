import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { normaliseExternalUrl } from '../services/media-service';
import { assertCsrf, assertSameOrigin, clientIp } from '../lib/http';
import { parseBody, parseQuery } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { recordAudit } from '../lib/audit';
import { newId, nowIso } from '../lib/ids';
import { hashPassword } from '../lib/crypto';
import {
  buildFrozenSnapshot,
  cloneVersionContent,
  loadAdminVersion,
  loadCandidateTest,
  recountQuestions,
  validateVersion,
} from '../services/content-service';
import { replaceVersionContent, type EditableContent } from '../services/content-write-service';
import { purgeTest, purgeVersion } from '../services/content-delete-service';
import { listWritingQueue, markQuestionManually, setWritingScore } from '../services/marking-service';
import { ensureDefaultScoringProfiles } from '../services/scoring-profile-service';
import { clearTestAccessCode, setTestAccessCode } from '../services/access-code-service';
import { schemaReport } from '../lib/ensure-schema';
import { buildResultView } from '../services/attempt-service';
import type { AttemptRow } from '../services/attempt-service';
import { getAdminAnalytics } from '../services/analytics-service';
import { aiStatus } from '../ai/openai';
import { validateConversionRanges } from '../../shared/scoring';
import { QUESTION_TYPES } from '../../shared/question-types';
import { TEST_TYPES, SKILLS, ROLES, CONTENT_ORIGINS } from '../../shared/types';
import { kindForMime } from '../extract';

const router = new Hono<AppBindings>();

router.use('*', requireAuth, requireRole('ADMIN'));
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', async (c) => {
  const analytics = await getAdminAnalytics(c.env);
  return c.json({
    analytics,
    ai: aiStatus(c.env),
    runtime: { environment: c.env.APP_ENV, baseUrl: c.env.APP_BASE_URL },
  });
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
router.get('/users', async (c) => {
  const query = parseQuery(
    c,
    z.object({
      role: z.enum(ROLES).optional(),
      search: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  );

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query.role) {
    conditions.push('u.role = ?');
    bindings.push(query.role);
  }
  if (query.search) {
    conditions.push('(u.email LIKE ? OR p.display_name LIKE ?)');
    bindings.push(`%${query.search}%`, `%${query.search}%`);
  }

  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_login_at, p.display_name,
            (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts,
            (SELECT COUNT(*) FROM classrooms c WHERE c.teacher_id = u.id) AS classrooms
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY u.created_at DESC
      LIMIT ${Math.min(query.limit ?? 100, 200)}`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();

  return c.json({ users: rows.results });
});

router.post('/users', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email().max(254),
      displayName: z.string().trim().min(1).max(120),
      role: z.enum(ROLES),
      password: z.string().min(10).max(200),
    }),
  );

  const { createUser } = await import('../services/auth-service');
  const user = await createUser(c.env, { ...body, createdBy: actor.id });

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'USER_CREATE',
    entityType: 'user',
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
    ip: clientIp(c),
  });

  return c.json({ user }, 201);
});

router.patch('/users/:id', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      role: z.enum(ROLES).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      displayName: z.string().trim().min(1).max(120).optional(),
      resetPassword: z.string().min(10).max(200).optional(),
    }),
  );

  const userId = c.req.param('id');
  const target = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; role: string }>();
  if (!target) throw ApiError.notFound('User not found.');

  if (actor.id === userId && (body.role || body.status === 'SUSPENDED')) {
    throw ApiError.forbidden('You cannot change your own role or suspend your own account.');
  }

  const statements: D1PreparedStatement[] = [];
  const timestamp = nowIso();

  if (body.role !== undefined || body.status !== undefined) {
    statements.push(
      c.env.DB.prepare('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status), updated_at = ? WHERE id = ?')
        .bind(body.role ?? null, body.status ?? null, timestamp, userId),
    );
  }

  if (body.displayName !== undefined) {
    statements.push(
      c.env.DB.prepare('UPDATE user_profiles SET display_name = ?, updated_at = ? WHERE user_id = ?')
        .bind(body.displayName, timestamp, userId),
    );
  }

  if (body.resetPassword) {
    const hashed = await hashPassword(body.resetPassword);
    statements.push(
      c.env.DB.prepare(
        `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, password_algo = ?,
                          failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      ).bind(hashed.hash, hashed.salt, hashed.iterations, hashed.algo, timestamp, userId),
    );
    statements.push(
      c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(timestamp, userId),
    );
  }

  if (statements.length === 0) throw ApiError.validation('Nothing to update.');
  await c.env.DB.batch(statements);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: body.resetPassword ? 'USER_PASSWORD_RESET' : 'USER_UPDATE',
    entityType: 'user',
    entityId: userId,
    metadata: { role: body.role, status: body.status, passwordReset: Boolean(body.resetPassword) },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tests and versions
// ---------------------------------------------------------------------------
const editableContentSchema = z.object({
  sections: z
    .array(
      z.object({
        skill: z.enum(SKILLS),
        title: z.string().max(300).default(''),
        subtitle: z.string().max(300).nullish(),
        instructions: z.string().max(8000).default(''),
        durationSeconds: z.number().int().min(30).max(36_000).nullish(),
        passage: z
          .object({
            title: z.string().max(300).default(''),
            subtitle: z.string().max(300).nullish(),
            // Declared by the source, ignored on write: the count is recomputed
            // from the text and a difference is surfaced as a warning.
            passageWordCount: z.number().int().min(0).max(50_000).nullish(),
            paragraphs: z.array(z.object({ label: z.string().max(20), text: z.string().max(60_000) })).max(200),
          })
          .nullish(),
        audioAssetId: z.string().max(2000).nullish(),
        audioUrl: z.string().max(2000).nullish(),
        playback: z
          .object({
            maxPlays: z.number().int().min(1).max(10).optional(),
            prepSeconds: z.number().int().min(0).max(600).optional(),
            allowPause: z.boolean().optional(),
            allowSeekAfterPlay: z.boolean().optional(),
          })
          .optional(),
        groups: z
          .array(
            z.object({
              type: z.enum(QUESTION_TYPES),
              instructions: z.string().max(8000).default(''),
              sharedOptions: z.array(z.object({ id: z.string().max(20), text: z.string().max(4000) })).max(40).default([]),
              config: z
                .object({
                  wordLimit: z.object({ min: z.number().int().min(0).max(2000).optional(), max: z.number().int().min(1).max(2000).optional() }).optional(),
                  selectCount: z.number().int().min(1).max(10).optional(),
                  note: z.string().max(500).optional(),
                  optionNumbering: z.enum(['roman', 'alpha', 'numeric']).optional(),
                })
                .default({}),
              rangeFrom: z.number().int().nullish(),
              rangeTo: z.number().int().nullish(),
              questions: z
                .array(
                  z.object({
                    number: z.number().int().min(1).max(400),
                    prompt: z.string().max(8000).default(''),
                    options: z.array(z.object({ id: z.string().max(20), text: z.string().max(4000) })).max(40).default([]),
                    config: z
                      .object({
                        wordLimit: z.object({ min: z.number().int().min(0).max(2000).optional(), max: z.number().int().min(1).max(2000).optional() }).optional(),
                        selectCount: z.number().int().min(1).max(10).optional(),
                        note: z.string().max(500).optional(),
                        optionNumbering: z.enum(['roman', 'alpha', 'numeric']).optional(),
                      })
                      .default({}),
                    body: z
                      .object({
                        kind: z.enum(['SUMMARY', 'NOTES', 'TABLE', 'FLOWCHART']),
                        text: z.string().max(20_000).optional(),
                        rows: z.array(z.array(z.string().max(2000))).max(60).optional(),
                      })
                      .nullish(),
                    answerKey: z
                      .union([
                        z.object({ kind: z.literal('CHOICE'), values: z.array(z.string().max(500)).max(20), partialCredit: z.boolean().optional() }),
                        z.object({
                          kind: z.literal('TEXT'),
                          accept: z.array(z.string().max(500)).max(20),
                          numeric: z.boolean().optional(),
                          ignoreLeadingArticle: z.boolean().optional(),
                        }),
                        z.object({ kind: z.literal('MANUAL') }),
                      ])
                      .nullish(),
                    evidence: z.string().max(4000).nullish(),
                    explanation: z.string().max(4000).nullish(),
                  }),
                )
                .max(100),
            }),
          )
          .max(20)
          .default([]),
      }),
    )
    .max(10),
  mockComponents: z
    .array(
      z.object({
        skill: z.enum(SKILLS),
        testVersionId: z.string().max(64).default(''),
        label: z.string().max(120).default(''),
        durationSeconds: z.number().int().min(60).max(36_000),
        breakAfterSeconds: z.number().int().min(0).max(3600).default(0),
      }),
    )
    .max(8)
    .optional(),
  durationSeconds: z.number().int().min(60).max(36_000).nullish(),
  isCompleteTest: z.boolean().optional(),
  scoringProfileId: z.string().max(64).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
});

router.get('/tests', async (c) => {
  const query = parseQuery(
    c,
    z.object({
      status: z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
      type: z.enum(TEST_TYPES).optional(),
      search: z.string().max(120).optional(),
    }),
  );

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query.status) {
    conditions.push('t.status = ?');
    bindings.push(query.status);
  }
  if (query.type) {
    conditions.push('t.type = ?');
    bindings.push(query.type);
  }
  if (query.search) {
    conditions.push('(t.title LIKE ? OR t.slug LIKE ?)');
    bindings.push(`%${query.search}%`, `%${query.search}%`);
  }

  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.slug, t.title, t.type, t.status, t.summary, t.content_origin, t.updated_at,
            t.current_version_id, t.access_code_hash IS NOT NULL AS requires_access_code,
            (SELECT COUNT(*) FROM test_versions v WHERE v.test_id = t.id) AS version_count,
            (SELECT v.total_questions FROM test_versions v WHERE v.id = t.current_version_id) AS total_questions,
            (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id) AS attempt_count,
            (SELECT COUNT(*) FROM mock_components mc WHERE mc.mock_version_id = t.current_version_id) AS component_count
       FROM tests t
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY t.updated_at DESC LIMIT 200`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();

  return c.json({ tests: rows.results });
});

router.post('/tests', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(3).max(200),
      type: z.enum(TEST_TYPES),
      summary: z.string().max(2000).optional(),
      contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
      sourceTitle: z.string().max(500).optional(),
      attribution: z.string().max(1000).optional(),
      licenseNotes: z.string().max(4000).optional(),
      cloneFromVersionId: z.string().max(64).optional(),
    }),
  );

  const testId = newId('tst');
  const versionId = newId('ver');
  const timestamp = nowIso();
  const slug = await uniqueSlug(c.env, body.title);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO tests (id, slug, title, type, status, summary, created_by, created_at, updated_at,
                          content_origin, source_title, attribution, license_notes)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      testId,
      slug,
      body.title,
      body.type,
      body.summary ?? '',
      actor.id,
      timestamp,
      timestamp,
      body.contentOrigin ?? 'ORIGINAL',
      body.sourceTitle ?? null,
      body.attribution ?? null,
      body.licenseNotes ?? null,
    ),
    c.env.DB.prepare(
      `INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions,
                                  created_by, created_at, updated_at)
       VALUES (?, ?, 1, 'DRAFT', 'Initial draft', '{}', 0, ?, ?, ?)`,
    ).bind(versionId, testId, actor.id, timestamp, timestamp),
  ]);

  if (body.cloneFromVersionId) {
    await cloneVersionContent(c.env, body.cloneFromVersionId, versionId);
  }

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_CREATE',
    entityType: 'test',
    entityId: testId,
    metadata: { title: body.title, type: body.type },
    ip: clientIp(c),
  });

  return c.json({ testId, versionId }, 201);
});

router.get('/tests/:testId', async (c) => {
  const test = await c.env.DB.prepare('SELECT * FROM tests WHERE id = ?').bind(c.req.param('testId')).first<Record<string, unknown>>();
  if (!test) throw ApiError.notFound('Test not found.');
  // Code hashes never leave the server, even to administrators.
  const { access_code_hash, access_code_salt, access_code_iterations, ...safeTest } = test;
  void access_code_hash;
  void access_code_salt;
  void access_code_iterations;
  const testWithFlag = { ...safeTest, requires_access_code: test.access_code_hash != null ? 1 : 0 };

  const versions = await c.env.DB.prepare(
    `SELECT v.id, v.version_number, v.status, v.change_note, v.total_questions, v.duration_seconds, v.is_complete_test,
            v.published_at, v.created_at, v.updated_at, v.validation_json, u.email AS published_by_email,
            (SELECT COUNT(*) FROM attempts a WHERE a.test_version_id = v.id) AS attempt_count
       FROM test_versions v
       LEFT JOIN users u ON u.id = v.published_by
      WHERE v.test_id = ?
      ORDER BY v.version_number DESC`,
  )
    .bind(c.req.param('testId'))
    .all<Record<string, unknown>>();

  return c.json({ test: testWithFlag, versions: versions.results });
});

/**
 * Attach (or rotate) the student access code for a test. Setting a code
 * revokes all previous unlocks, so every student must enter the new code.
 * The plaintext code is accepted here but only its hash is stored.
 */
router.post('/tests/:testId/access-code', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ code: z.string().trim().min(1).max(64) }));

  await setTestAccessCode(c.env, c.req.param('testId'), body.code, actor.id);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_ACCESS_CODE_SET',
    entityType: 'test',
    entityId: c.req.param('testId'),
    ip: clientIp(c),
  });

  return c.json({ ok: true, requiresAccessCode: true });
});

router.delete('/tests/:testId/access-code', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);

  await clearTestAccessCode(c.env, c.req.param('testId'));

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_ACCESS_CODE_CLEARED',
    entityType: 'test',
    entityId: c.req.param('testId'),
    ip: clientIp(c),
  });

  return c.json({ ok: true, requiresAccessCode: false });
});

router.patch('/tests/:testId', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(3).max(200).optional(),
      summary: z.string().max(2000).optional(),
      type: z.enum(TEST_TYPES).optional(),
      contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
      sourceTitle: z.string().max(500).nullable().optional(),
      sourceUrl: z.string().max(1000).nullable().optional(),
      attribution: z.string().max(1000).nullable().optional(),
      licenseNotes: z.string().max(4000).nullable().optional(),
    }),
  );

  const testId = c.req.param('testId');
  const setClauses: string[] = [];
  const bindings: unknown[] = [];
  for (const [field, column] of [
    ['title', 'title'],
    ['summary', 'summary'],
    ['type', 'type'],
    ['contentOrigin', 'content_origin'],
    ['sourceTitle', 'source_title'],
    ['sourceUrl', 'source_url'],
    ['attribution', 'attribution'],
    ['licenseNotes', 'license_notes'],
  ] as const) {
    const value = body[field];
    if (value !== undefined) {
      setClauses.push(`${column} = ?`);
      bindings.push(value);
    }
  }
  if (setClauses.length === 0) throw ApiError.validation('Nothing to update.');
  setClauses.push('updated_at = ?');
  bindings.push(nowIso(), testId);

  await c.env.DB.prepare(`UPDATE tests SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run();

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_UPDATE',
    entityType: 'test',
    entityId: testId,
    metadata: { fields: Object.keys(body) },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

/** Permanently delete a test, its versions, and attempts on those versions. */
router.delete('/tests/:testId', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const testId = c.req.param('testId');

  const result = await purgeTest(c.env, testId);
  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_DELETE',
    entityType: 'test',
    entityId: testId,
    metadata: result,
    ip: clientIp(c),
  });

  return c.json({ ok: true, ...result });
});

router.delete('/versions/:versionId', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const versionId = c.req.param('versionId');

  const result = await purgeVersion(c.env, versionId);
  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_DELETE',
    entityType: 'test_version',
    entityId: versionId,
    metadata: result,
    ip: clientIp(c),
  });

  return c.json({ ok: true, ...result });
});

router.post('/tests/:testId/archive', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const testId = c.req.param('testId');
  const timestamp = nowIso();

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tests SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?`)
      .bind(timestamp, timestamp, testId),
    c.env.DB.prepare(`UPDATE test_versions SET status = 'ARCHIVED', archived_at = ? WHERE test_id = ? AND status = 'PUBLISHED'`)
      .bind(timestamp, testId),
  ]);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'TEST_ARCHIVE',
    entityType: 'test',
    entityId: testId,
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

router.get('/versions/:versionId', async (c) => {
  const content = await loadAdminVersion(c.env, c.req.param('versionId'));
  const attempts = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM attempts WHERE test_version_id = ?',
  )
    .bind(c.req.param('versionId'))
    .first<{ count: number }>();

  return c.json({ ...content, attemptCount: attempts?.count ?? 0, editable: ['DRAFT', 'REVIEW'].includes(content.version.status) });
});

router.post('/tests/:testId/versions', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ fromVersionId: z.string().max(64).optional(), changeNote: z.string().max(500).optional() }),
  );

  const testId = c.req.param('testId');
  const test = await c.env.DB.prepare('SELECT id, current_version_id FROM tests WHERE id = ?')
    .bind(testId)
    .first<{ id: string; current_version_id: string | null }>();
  if (!test) throw ApiError.notFound('Test not found.');

  const latest = await c.env.DB.prepare('SELECT MAX(version_number) AS max_version FROM test_versions WHERE test_id = ?')
    .bind(testId)
    .first<{ max_version: number | null }>();

  const versionId = newId('ver');
  const timestamp = nowIso();
  const nextNumber = (latest?.max_version ?? 0) + 1;

  await c.env.DB.prepare(
    `INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions,
                                created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'DRAFT', ?, '{}', 0, ?, ?, ?)`,
  )
    .bind(
      versionId,
      testId,
      nextNumber,
      body.changeNote ?? `New version from v${nextNumber - 1}`,
      actor.id,
      timestamp,
      timestamp,
    )
    .run();

  const sourceVersionId = body.fromVersionId ?? test.current_version_id;
  if (sourceVersionId) {
    await cloneVersionContent(c.env, sourceVersionId, versionId);
    const source = await c.env.DB.prepare('SELECT config_json, duration_seconds, is_complete_test, scoring_profile_id FROM test_versions WHERE id = ?')
      .bind(sourceVersionId)
      .first<{ config_json: string; duration_seconds: number | null; is_complete_test: number; scoring_profile_id: string | null }>();
    if (source) {
      await c.env.DB.prepare(
        `UPDATE test_versions SET config_json = ?, duration_seconds = ?, is_complete_test = ?, scoring_profile_id = ? WHERE id = ?`,
      )
        .bind(source.config_json, source.duration_seconds, source.is_complete_test, source.scoring_profile_id, versionId)
        .run();
    }
  }

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_CREATE',
    entityType: 'test_version',
    entityId: versionId,
    metadata: { testId, fromVersionId: sourceVersionId, versionNumber: nextNumber },
    ip: clientIp(c),
  });

  return c.json({ versionId, versionNumber: nextNumber }, 201);
});

router.put('/versions/:versionId/content', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, editableContentSchema);
  const versionId = c.req.param('versionId');

  const result = await replaceVersionContent(c.env, versionId, body as EditableContent, actor.id);
  const validation = await validateVersion(c.env, versionId);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_CONTENT_UPDATE',
    entityType: 'test_version',
    entityId: versionId,
    metadata: { totalQuestions: result.totalQuestions, errors: validation.errors },
    ip: clientIp(c),
  });

  return c.json({ ok: true, totalQuestions: result.totalQuestions, validation });
});

router.post('/versions/:versionId/validate', async (c) => {
  const validation = await validateVersion(c.env, c.req.param('versionId'));
  return c.json(validation);
});

/** Publishes immutably: freezes a canonical snapshot and supersedes older versions. */
router.post('/versions/:versionId/publish', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const versionId = c.req.param('versionId');
  const body = await parseBody(
    c,
    z.object({ changeNote: z.string().max(500).optional(), allowWarnings: z.boolean().optional() }).default({}),
  );

  await recountQuestions(c.env, versionId);
  const validation = await validateVersion(c.env, versionId);
  if (!validation.publishable) {
    throw new ApiError('CONFLICT', 'This version has validation errors and cannot be published.', {
      issues: validation.issues.filter((issue) => issue.level === 'ERROR'),
    });
  }

  const content = await loadAdminVersion(c.env, versionId);
  if (content.version.status === 'PUBLISHED') {
    throw ApiError.conflict('This version is already published.');
  }

  const timestamp = nowIso();
  const snapshot = buildFrozenSnapshot(content);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE test_versions SET status = 'PUBLISHED', published_at = ?, published_by = ?, frozen_snapshot_json = ?,
                                change_note = COALESCE(?, change_note), validation_json = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      timestamp,
      actor.id,
      JSON.stringify(snapshot),
      body.changeNote ?? null,
      JSON.stringify({ ...validation, checkedAt: timestamp }),
      timestamp,
      versionId,
    ),
    c.env.DB.prepare(
      `UPDATE test_versions SET status = 'ARCHIVED', archived_at = ?
        WHERE test_id = ? AND id != ? AND status = 'PUBLISHED'`,
    ).bind(timestamp, content.version.testId, versionId),
    c.env.DB.prepare(`UPDATE tests SET status = 'PUBLISHED', current_version_id = ?, updated_at = ? WHERE id = ?`)
      .bind(versionId, timestamp, content.version.testId),
  ]);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_PUBLISH',
    entityType: 'test_version',
    entityId: versionId,
    metadata: {
      testId: content.version.testId,
      versionNumber: content.version.versionNumber,
      totalQuestions: content.version.totalQuestions,
      warnings: validation.warnings,
    },
    ip: clientIp(c),
  });

  return c.json({ ok: true, versionNumber: content.version.versionNumber, warnings: validation.warnings });
});

router.post('/versions/:versionId/unpublish', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const versionId = c.req.param('versionId');
  const version = await c.env.DB.prepare('SELECT id, test_id, status FROM test_versions WHERE id = ?')
    .bind(versionId)
    .first<{ id: string; test_id: string; status: string }>();
  if (!version) throw ApiError.notFound('Version not found.');

  const attempts = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM attempts WHERE test_version_id = ?')
    .bind(versionId)
    .first<{ count: number }>();

  const timestamp = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE test_versions SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?`)
      .bind(timestamp, timestamp, versionId),
    c.env.DB.prepare(
      `UPDATE tests SET status = 'ARCHIVED', current_version_id = NULL, updated_at = ?
        WHERE id = ? AND current_version_id = ?`,
    ).bind(timestamp, version.test_id, versionId),
  ]);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_UNPUBLISH',
    entityType: 'test_version',
    entityId: versionId,
    metadata: { preservedAttempts: attempts?.count ?? 0 },
    ip: clientIp(c),
  });

  return c.json({
    ok: true,
    preservedAttempts: attempts?.count ?? 0,
    message:
      'The version was archived. Existing attempts keep the exact content they were taken with.',
  });
});

router.post('/versions/:versionId/clone', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const sourceVersionId = c.req.param('versionId');
  const body = await parseBody(c, z.object({ changeNote: z.string().max(500).optional() }).default({}));

  const source = await c.env.DB.prepare('SELECT id, test_id FROM test_versions WHERE id = ?')
    .bind(sourceVersionId)
    .first<{ id: string; test_id: string }>();
  if (!source) throw ApiError.notFound('Version not found.');

  const latest = await c.env.DB.prepare('SELECT MAX(version_number) AS max_version FROM test_versions WHERE test_id = ?')
    .bind(source.test_id)
    .first<{ max_version: number | null }>();

  const versionId = newId('ver');
  const timestamp = nowIso();
  const nextNumber = (latest?.max_version ?? 0) + 1;

  await c.env.DB.prepare(
    `INSERT INTO test_versions (id, test_id, version_number, status, change_note, config_json, total_questions,
                                created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'DRAFT', ?, '{}', 0, ?, ?, ?)`,
  )
    .bind(versionId, source.test_id, nextNumber, body.changeNote ?? `Cloned from an earlier version`, actor.id, timestamp, timestamp)
    .run();

  await cloneVersionContent(c.env, sourceVersionId, versionId);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'VERSION_CLONE',
    entityType: 'test_version',
    entityId: versionId,
    metadata: { fromVersionId: sourceVersionId },
    ip: clientIp(c),
  });

  return c.json({ versionId, versionNumber: nextNumber }, 201);
});

/** "Preview as candidate" - the payload contains no answer material. */
router.get('/versions/:versionId/preview', async (c) => {
  const { payload } = await loadCandidateTest(c.env, c.req.param('versionId'));
  return c.json({ preview: true, test: payload });
});

// ---------------------------------------------------------------------------
// Scoring profiles
// ---------------------------------------------------------------------------
router.get('/scoring-profiles', async (c) => {
  await ensureDefaultScoringProfiles(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM score_conversion_ranges r WHERE r.profile_id = p.id) AS range_count,
            (SELECT COUNT(*) FROM test_versions v WHERE v.scoring_profile_id = p.id) AS usage_count
       FROM scoring_profiles p
      ORDER BY p.skill, p.name, p.version DESC`,
  ).all<Record<string, unknown>>();

  return c.json({ profiles: rows.results });
});

router.get('/scoring-profiles/:id', async (c) => {
  const profile = await c.env.DB.prepare('SELECT * FROM scoring_profiles WHERE id = ?')
    .bind(c.req.param('id'))
    .first();
  if (!profile) throw ApiError.notFound('Scoring profile not found.');
  const ranges = await c.env.DB.prepare('SELECT raw_min, raw_max, band FROM score_conversion_ranges WHERE profile_id = ? ORDER BY raw_min')
    .bind(c.req.param('id'))
    .all();
  return c.json({ profile, ranges: ranges.results });
});

const rangeSchema = z.object({
  rawMin: z.number().int().min(0).max(200),
  rawMax: z.number().int().min(0).max(200),
  band: z.number().min(0).max(9),
});

router.post('/scoring-profiles', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(3).max(120),
      skill: z.enum(SKILLS),
      testType: z.enum(TEST_TYPES),
      minQuestions: z.number().int().min(1).max(100),
      sourceNotes: z.string().max(2000).optional(),
      ranges: z.array(rangeSchema).min(1).max(60),
      activate: z.boolean().optional(),
    }),
  );

  const check = validateConversionRanges(
    body.ranges.map((range) => ({ rawMin: range.rawMin, rawMax: range.rawMax, band: range.band })),
    body.minQuestions,
  );
  if (check.errors.length > 0) {
    throw ApiError.validation('The conversion table is invalid.', { errors: check.errors, warnings: check.warnings });
  }

  const versionRow = await c.env.DB.prepare(
    'SELECT MAX(version) AS max_version FROM scoring_profiles WHERE name = ?',
  )
    .bind(body.name)
    .first<{ max_version: number | null }>();

  const id = newId('scp');
  const timestamp = nowIso();
  const version = (versionRow?.max_version ?? 0) + 1;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO scoring_profiles (id, name, skill, test_type, version, status, min_questions, source_notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      body.name,
      body.skill,
      body.testType,
      version,
      body.activate === false ? 'INACTIVE' : 'ACTIVE',
      body.minQuestions,
      body.sourceNotes ?? '',
      actor.id,
      timestamp,
      timestamp,
    ),
  ];

  body.ranges.forEach((range, index) => {
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO score_conversion_ranges (id, profile_id, raw_min, raw_max, band, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(newId('scr'), id, range.rawMin, range.rawMax, range.band, index),
    );
  });

  await c.env.DB.batch(statements);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'SCORING_PROFILE_CREATE',
    entityType: 'scoring_profile',
    entityId: id,
    metadata: { name: body.name, version, skill: body.skill },
    ip: clientIp(c),
  });

  return c.json({ profileId: id, version, warnings: check.warnings }, 201);
});

router.post('/scoring-profiles/:id/status', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }));
  const id = c.req.param('id');

  await c.env.DB.prepare('UPDATE scoring_profiles SET status = ?, updated_at = ? WHERE id = ?')
    .bind(body.status, nowIso(), id)
    .run();

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'SCORING_PROFILE_STATUS',
    entityType: 'scoring_profile',
    entityId: id,
    metadata: { status: body.status },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Attempts, writing scores, audit log, settings, assets
// ---------------------------------------------------------------------------
router.get('/attempts', async (c) => {
  const query = parseQuery(
    c,
    z.object({
      testType: z.enum(TEST_TYPES).optional(),
      status: z.enum(['IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED']).optional(),
      userId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  );

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (query.testType) {
    conditions.push('a.test_type = ?');
    bindings.push(query.testType);
  }
  if (query.status) {
    conditions.push('a.status = ?');
    bindings.push(query.status);
  }
  if (query.userId) {
    conditions.push('a.user_id = ?');
    bindings.push(query.userId);
  }

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.status, a.mode, a.test_type, a.started_at, a.submitted_at, a.raw_score, a.total_questions,
            a.estimated_band, a.submitted_reason, t.title AS test_title, u.email,
            p.display_name, v.version_number,
            (SELECT COUNT(*) FROM integrity_events e WHERE e.attempt_id = a.id AND e.type IN ('TAB_HIDDEN','FULLSCREEN_EXIT','COPY_ATTEMPT','PASTE_ATTEMPT')) AS integrity_count
       FROM attempts a
       JOIN tests t ON t.id = a.test_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_profiles p ON p.user_id = a.user_id
       JOIN test_versions v ON v.id = a.test_version_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY a.started_at DESC
      LIMIT ${Math.min(query.limit ?? 100, 200)}`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();

  return c.json({ attempts: rows.results });
});

router.get('/attempts/:attemptId', async (c) => {
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(c.req.param('attemptId'))
    .first<AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  const view = await buildResultView(c.env, attempt, { includeReview: true, viewerIsStaff: true });
  const student = await c.env.DB.prepare(
    'SELECT u.email, p.display_name FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?',
  )
    .bind(attempt.user_id)
    .first<{ email: string; display_name: string | null }>();

  return c.json({ ...view, student: { id: attempt.user_id, email: student?.email, displayName: student?.display_name } });
});

router.get('/writing-queue', async (c) => {
  const user = currentUser(c);
  const unmarkedOnly = c.req.query('unmarked') === '1' || c.req.query('unmarked') === 'true';
  return c.json(await listWritingQueue(c.env, user, { unmarkedOnly }));
});

router.post('/writing-scores', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      writingSubmissionId: z.string().min(1).max(64),
      band: z.number().min(0).max(9).nullable(),
      feedback: z.string().max(8000).optional(),
      criteria: z.record(z.string(), z.number().min(0).max(9)).optional(),
    }),
  );

  const result = await setWritingScore(c.env, {
    writingSubmissionId: body.writingSubmissionId,
    band: body.band,
    feedback: body.feedback,
    criteria: body.criteria,
    source: 'ADMIN',
    scoredBy: actor.id,
  });

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'WRITING_SCORE_SET',
    entityType: 'writing_submission',
    entityId: body.writingSubmissionId,
    metadata: { band: body.band, attemptId: result.attemptId },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

router.post('/attempts/:attemptId/question-marks', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      questionId: z.string().min(1).max(64),
      isCorrect: z.boolean().nullable(),
      points: z.number().min(0).max(20).nullable().optional(),
    }),
  );
  const totals = await markQuestionManually(c.env, c.req.param('attemptId'), body);
  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'QUESTION_MARK_SET',
    entityType: 'attempt',
    entityId: c.req.param('attemptId'),
    metadata: { questionId: body.questionId, isCorrect: body.isCorrect },
    ip: clientIp(c),
  });
  return c.json({ ok: true, ...totals });
});

router.get('/audit-logs', async (c) => {
  const query = parseQuery(
    c,
    z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), action: z.string().max(80).optional() }),
  );
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.metadata_json, l.ip, l.created_at, u.email AS actor_email
       FROM admin_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
      ${query.action ? 'WHERE l.action = ?' : ''}
      ORDER BY l.created_at DESC
      LIMIT ${Math.min(query.limit ?? 100, 200)}`,
  )
    .bind(...(query.action ? [query.action] : []))
    .all<Record<string, unknown>>();

  return c.json({
    logs: rows.results.map((row) => ({
      ...row,
      metadata: typeof row['metadata_json'] === 'string' ? safeJson(row['metadata_json'] as string) : {},
    })),
  });
});

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

router.get('/settings', async (c) => {
  const rows = await c.env.DB.prepare('SELECT key, value_json, updated_at FROM platform_settings').all<{
    key: string;
    value_json: string;
    updated_at: string;
  }>();
  const settings: Record<string, unknown> = {};
  for (const row of rows.results) settings[row.key] = safeJson(row.value_json);
  return c.json({ settings, ai: aiStatus(c.env) });
});

router.patch('/settings', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ settings: z.record(z.string().max(64), z.unknown()) }));

  const timestamp = nowIso();
  const statements = Object.entries(body.settings).map(([key, value]) =>
    c.env.DB.prepare(
      `INSERT INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(key, JSON.stringify(value), actor.id, timestamp),
  );

  if (statements.length > 0) await c.env.DB.batch(statements);

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'SETTINGS_UPDATE',
    entityType: 'platform_settings',
    metadata: { keys: Object.keys(body.settings) },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// System: database schema diagnostics
// ---------------------------------------------------------------------------
/**
 * Reports which application tables exist and repairs the schema in place by
 * creating anything missing. Nothing existing is altered or dropped, so this is
 * safe to run at any time — including on a healthy database.
 */
router.get('/system/schema', async (c) => {
  const report = await schemaReport(c.env);
  return c.json({
    ...report,
    environment: c.env.APP_ENV,
    baseUrl: c.env.APP_BASE_URL,
    migrationCommand: 'npx wrangler d1 migrations apply DB --remote',
  });
});

router.post('/system/schema/repair', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const report = await schemaReport(c.env);
  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'SCHEMA_REPAIR',
    entityType: 'system',
    metadata: { created: report.created ?? [], missing: report.missing },
    ip: clientIp(c),
  });
  return c.json({ ...report, migrationCommand: 'npx wrangler d1 migrations apply DB --remote' });
});

// ---------------------------------------------------------------------------
// Assets (audio, images, documents)
// ---------------------------------------------------------------------------
router.get('/assets', async (c) => {
  const query = parseQuery(c, z.object({ kind: z.enum(['PDF', 'DOC', 'IMAGE', 'AUDIO', 'OTHER']).optional() }));
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.kind, a.storage_kind, a.external_url, a.filename, a.mime, a.size_bytes, a.duration_seconds,
            a.alt_text, a.visibility, a.test_version_id, a.created_at, a.updated_at,
            u.email AS uploaded_by_email, t.title AS test_title
       FROM assets a
       LEFT JOIN users u ON u.id = a.uploaded_by
       LEFT JOIN test_versions v ON v.id = a.test_version_id
       LEFT JOIN tests t ON t.id = v.test_id
      ${query.kind ? 'WHERE a.kind = ?' : ''}
      ORDER BY a.created_at DESC LIMIT 200`,
  )
    .bind(...(query.kind ? [query.kind] : []))
    .all<Record<string, unknown>>();

  return c.json({ assets: rows.results });
});

router.post('/assets', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      url: z.string().trim().min(1).max(2000),
      kind: z.enum(['PDF', 'DOC', 'IMAGE', 'AUDIO', 'OTHER']).optional(),
      filename: z.string().max(160).optional(),
      altText: z.string().max(500).nullish(),
      durationSeconds: z.number().min(0).max(36_000).nullish(),
      testVersionId: z.string().max(64).nullish(),
      visibility: z.enum(['PRIVATE', 'ATTEMPT']).optional(),
    }),
  );

  const externalUrl = normaliseExternalUrl(body.url);
  if (!externalUrl) {
    throw ApiError.validation(
      'Enter a plain HTTPS media URL (https://…). Media is linked, not uploaded: V1 does not store files.',
    );
  }

  const id = newId('ast');
  const filename = (body.filename?.trim() || filenameFromUrl(externalUrl)).slice(0, 160);
  const kind = body.kind ?? kindForMime(mimeFromUrl(externalUrl), filename);
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO assets (id, kind, storage_kind, external_url, filename, mime, size_bytes, alt_text,
                         duration_seconds, visibility, test_version_id, uploaded_by, created_at, updated_at)
     VALUES (?, ?, 'EXTERNAL_URL', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      kind,
      externalUrl,
      filename,
      mimeFromUrl(externalUrl),
      body.altText ?? null,
      body.durationSeconds ?? null,
      body.visibility ?? (kind === 'AUDIO' || kind === 'IMAGE' ? 'ATTEMPT' : 'PRIVATE'),
      body.testVersionId ?? null,
      actor.id,
      timestamp,
      timestamp,
    )
    .run();

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'ASSET_LINK',
    entityType: 'asset',
    entityId: id,
    metadata: { kind, host: new URL(externalUrl).host },
    ip: clientIp(c),
  });

  return c.json({ assetId: id, kind, filename, url: externalUrl, deliveryUrl: `/api/files/${id}` }, 201);
});

/** Best-effort file name and MIME type from the URL path. */
function filenameFromUrl(raw: string): string {
  try {
    const path = new URL(raw).pathname;
    const last = path.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'external-media';
  } catch {
    return 'external-media';
  }
}

function mimeFromUrl(raw: string): string {
  const extension = raw.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

router.patch('/assets/:id', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      url: z.string().trim().max(2000).optional(),
      altText: z.string().max(500).nullish(),
      durationSeconds: z.number().min(0).max(36_000).nullish(),
      testVersionId: z.string().max(64).nullish(),
      visibility: z.enum(['PRIVATE', 'ATTEMPT']).optional(),
    }),
  );
  const id = c.req.param('id');

  let externalUrl: string | null = null;
  if (body.url !== undefined) {
    const candidate = normaliseExternalUrl(body.url);
    if (!candidate) throw ApiError.validation('Enter a plain HTTPS media URL (https://…).');
    externalUrl = candidate;
  }

  await c.env.DB.prepare(
    `UPDATE assets SET external_url = COALESCE(?, external_url), alt_text = COALESCE(?, alt_text),
                       duration_seconds = COALESCE(?, duration_seconds),
                       test_version_id = COALESCE(?, test_version_id), visibility = COALESCE(?, visibility),
                       updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      externalUrl,
      body.altText ?? null,
      body.durationSeconds ?? null,
      body.testVersionId ?? null,
      body.visibility ?? null,
      nowIso(),
      id,
    )
    .run();

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'ASSET_UPDATE',
    entityType: 'asset',
    entityId: id,
    metadata: body,
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

router.delete('/assets/:id', async (c) => {
  const actor = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const id = c.req.param('id');

  const asset = await c.env.DB.prepare('SELECT id, test_version_id, kind FROM assets WHERE id = ?')
    .bind(id)
    .first<{ id: string; test_version_id: string | null; kind: string }>();
  if (!asset) throw ApiError.notFound('Asset not found.');

  if (asset.test_version_id) {
    const inUse = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM sections WHERE audio_asset_id = ?`,
    )
      .bind(id)
      .first<{ count: number }>();
    if ((inUse?.count ?? 0) > 0) {
      throw ApiError.conflict('This asset is attached to a section. Detach it before deleting.');
    }
  }

  // V1 links media instead of storing it, so deleting the record is the whole
  // operation; the external file itself is untouched and stays the owner's.
  await c.env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();

  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: 'ASSET_DELETE',
    entityType: 'asset',
    entityId: id,
    metadata: { kind: asset.kind },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

async function uniqueSlug(env: AppBindings['Bindings'], title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'test';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await env.DB.prepare('SELECT id FROM tests WHERE slug = ?').bind(candidate).first<{ id: string }>();
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export default router;
