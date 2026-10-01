import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp, userAgent } from '../lib/http';
import { parseBody } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import {
  advanceComponent,
  applyIntegrityPolicy,
  completeSection,
  createAttempt,
  loadAttemptResult,
  loadCandidateAttemptState,
  recordIntegrityEvents,
  saveAnswers,
  saveWritingResponse,
  submitAttempt,
} from '../services/attempt-service';
import { scoreWritingSubmissionWithAi } from '../services/ai-marking-service';
import { INTEGRITY_EVENT_TYPES } from '../../shared/integrity';
import { EXAM_MODES } from '../../shared/types';
import { recordAudit } from '../lib/audit';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

/** Any authenticated role may own an attempt (students primarily; staff previewing). */
const responseSchema = z.union([
  z.object({ value: z.string().max(4000) }),
  z.object({ values: z.array(z.string().max(4000)).max(20) }),
]);

router.post('/', requireRole('STUDENT', 'TEACHER', 'ADMIN'), async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      testId: z.string().min(1).optional(),
      testVersionId: z.string().min(1).optional(),
      assignmentId: z.string().min(1).optional(),
      accessCode: z.string().trim().min(1).max(64).optional(),
      mode: z.enum(EXAM_MODES).optional(),
      clientMeta: z
        .object({
          userAgent: z.string().max(400).optional(),
          viewport: z.string().max(40).optional(),
          timezone: z.string().max(64).optional(),
        })
        .optional(),
    }),
  );

  if (!body.testId && !body.testVersionId && !body.assignmentId) {
    throw ApiError.validation('Provide a test, test version or assignment.');
  }
  // Only staff may request an elevated integrity mode for self-service practice.
  const requestedMode = user.role === 'STUDENT' ? 'PRACTICE' : body.mode;

  const result = await createAttempt(c.env, user, {
    ...(body.testId ? { testId: body.testId } : {}),
    ...(body.testVersionId ? { testVersionId: body.testVersionId } : {}),
    ...(body.assignmentId ? { assignmentId: body.assignmentId } : {}),
    ...(body.accessCode ? { accessCode: body.accessCode } : {}),
    ...(requestedMode ? { mode: requestedMode } : {}),
    clientMeta: { ...(body.clientMeta ?? {}), ip: clientIp(c) },
  });

  return c.json(result, 201);
});

router.get('/:id', async (c) => {
  const user = currentUser(c);
  const state = await loadCandidateAttemptState(c.env, user, c.req.param('id'));
  return c.json(state);
});

router.patch('/:id/answers', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      updates: z
        .array(
          z.object({
            questionId: z.string().min(1),
            response: responseSchema.nullable(),
            flagged: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(60),
    }),
  );

  const result = await saveAnswers(c.env, user, c.req.param('id'), body.updates);
  return c.json({ ok: true, ...result, savedAt: new Date().toISOString() });
});

router.post('/:id/writing', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ questionId: z.string().min(1), text: z.string().max(40_000) }),
  );
  const result = await saveWritingResponse(c.env, user, c.req.param('id'), body.questionId, body.text);
  return c.json({ ok: true, ...result, savedAt: new Date().toISOString() });
});

/**
 * Candidate-triggered AI feedback on the Writing tasks of their own attempt.
 * Available once the attempt is submitted; the band is labelled an estimate and
 * a teacher's score always takes precedence.
 */
router.post('/:id/ai-mark-writing', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const attemptId = c.req.param('id');
  const attempt = await c.env.DB.prepare(
    'SELECT id, user_id, status FROM attempts WHERE id = ?',
  )
    .bind(attemptId)
    .first<{ id: string; user_id: string; status: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.user_id !== user.id && user.role === 'STUDENT') {
    throw ApiError.forbidden('That attempt belongs to another candidate.');
  }

  const submissions = await c.env.DB.prepare(
    `SELECT id FROM writing_submissions WHERE attempt_id = ? AND TRIM(response_text) != '' ORDER BY created_at`,
  )
    .bind(attemptId)
    .all<{ id: string }>();
  if (submissions.results.length === 0) {
    throw ApiError.validation('There is no Writing response to mark on this attempt.');
  }

  const body = await parseBody(c, z.object({ providerId: z.string().max(64).optional() }).optional());
  const grades = [];
  const failures: Array<{ submissionId: string; message: string }> = [];
  for (const submission of submissions.results) {
    try {
      grades.push(
        await scoreWritingSubmissionWithAi(c.env, submission.id, {
          ...(body?.providerId ? { providerId: body.providerId } : {}),
        }),
      );
    } catch (error) {
      failures.push({
        submissionId: submission.id,
        message: error instanceof ApiError ? error.message : 'The AI provider could not mark this response.',
      });
    }
  }

  if (grades.length === 0) {
    throw new ApiError('AI_UNAVAILABLE', failures[0]?.message ?? 'The AI provider could not mark this attempt.');
  }
  return c.json({
    ok: true,
    marked: grades.length,
    failures,
    scores: grades.map((grade) => ({ band: grade.band, feedback: grade.feedback, criteria: grade.criteria })),
  });
});

router.post('/:id/integrity', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      events: z
        .array(
          z.object({
            type: z.enum(INTEGRITY_EVENT_TYPES),
            occurredAt: z.string().max(40).optional(),
            clientSeq: z.number().int().nonnegative().optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .max(50),
    }),
  );

  const result = await applyIntegrityPolicy(c.env, user, c.req.param('id'), body.events, {
    userAgent: userAgent(c),
  });
  return c.json(result);
});

router.post('/:id/advance', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const result = await advanceComponent(c.env, user, c.req.param('id'));
  return c.json(result);
});

/** 34/39: candidate completes the current section/part; the policy opens the next. */
router.post('/:id/complete-section', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ sectionId: z.string().min(1).max(64).optional() }),
  );
  const result = await completeSection(c.env, user, c.req.param('id'), body.sectionId ?? null);
  return c.json(result);
});

router.post('/:id/submit', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      confirmUnanswered: z.boolean().optional(),
      reason: z.enum(['CANDIDATE', 'TIMEOUT', 'INTEGRITY_AUTO', 'ADMIN']).optional(),
    }),
  );

  const attempt = await c.env.DB.prepare('SELECT user_id, status FROM attempts WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ user_id: string; status: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');

  // A student may only submit with a candidate reason; teachers/admins may force.
  const reason =
    user.role !== 'STUDENT' && body.reason ? body.reason : ('CANDIDATE' as const);

  const result = await submitAttempt(c.env, user, c.req.param('id'), reason);

  if (user.role !== 'STUDENT' && attempt.user_id !== user.id) {
    await recordAudit(c.env, {
      actorUserId: user.id,
      action: 'ATTEMPT_FORCE_SUBMIT',
      entityType: 'attempt',
      entityId: c.req.param('id'),
      metadata: { reason },
      ip: clientIp(c),
    });
  }

  await recordIntegrityEvents(c.env, c.req.param('id'), [
    { type: 'SUBMIT', metadata: { reason, by: user.role } },
  ]);

  return c.json(result);
});

router.get('/:id/result', async (c) => {
  const user = currentUser(c);
  const result = await loadAttemptResult(c.env, user, c.req.param('id'));
  return c.json(result);
});

export default router;
