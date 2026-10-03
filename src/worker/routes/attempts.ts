import { Hono, type Context } from 'hono';
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
import { describeAiFailure } from '../ai/failure';
import { markWritingSubmission } from '../services/ai-marking-service';
import { enforceRateLimit } from '../lib/rate-limit';
import type { AiMarkView } from '../../shared/judges';
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
 * AI marking of the Writing tasks of a finished attempt, done by the judging panel.
 *
 * The result page calls this by itself as soon as it opens (Writing is marked
 * automatically; Reading and Listening never need it, they are marked against the
 * protected key). It is idempotent: judges that already answered are not asked
 * again, so a retry only fills in the judge that failed, and `force` re-marks
 * everything. The band is labelled an estimate and a teacher's band always wins.
 *
 * This is deliberately a long, client-driven request rather than background work:
 * background tasks on the platform are cut off roughly 30 seconds after the
 * response, which is shorter than two reasoning models need.
 */
const aiMarkWriting = async (c: Context<AppBindings>) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const attemptId = c.req.param('id') ?? '';
  const attempt = await c.env.DB.prepare('SELECT id, user_id, status FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<{ id: string; user_id: string; status: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.user_id !== user.id && user.role === 'STUDENT') {
    throw ApiError.forbidden('That attempt belongs to another candidate.');
  }
  // Feedback on a draft would be exam help, so only a finished attempt qualifies.
  if (attempt.status === 'IN_PROGRESS') {
    throw ApiError.conflict('Submit the attempt before asking the judges to mark your writing.');
  }

  const body = await parseBody(c, z.object({ force: z.boolean().optional() }).optional());
  const submissions = await c.env.DB.prepare(
    `SELECT id FROM writing_submissions WHERE attempt_id = ? AND TRIM(response_text) != '' ORDER BY created_at`,
  )
    .bind(attemptId)
    .all<{ id: string }>();
  if (submissions.results.length === 0) {
    return c.json({ ok: true, marked: 0, status: 'NOTHING_TO_MARK', marks: {}, failures: [] });
  }

  await enforceRateLimit(
    c.env,
    { bucket: `ai-mark:${user.id}`, windowSeconds: 3600, limit: Number(c.env.AI_RATE_LIMIT_PER_HOUR || 30) },
    'You have asked the judges to mark a lot of work this hour. Please try again a little later.',
  );

  // The tasks are independent, so they are marked concurrently: a reasoning model
  // can take half a minute per response and two in a row made the page wait for a minute.
  const settled = await Promise.allSettled(
    submissions.results.map((submission) =>
      markWritingSubmission(c.env, submission.id, { actorUserId: user.id, force: body?.force ?? false }),
    ),
  );

  const marks: Record<string, AiMarkView> = {};
  const failures: Array<{ submissionId: string; judge: string | null; message: string }> = [];
  settled.forEach((outcome, index) => {
    const submissionId = submissions.results[index]!.id;
    if (outcome.status === 'fulfilled') {
      marks[submissionId] = outcome.value.view;
      for (const failure of outcome.value.failures) {
        failures.push({ submissionId, judge: failure.judge, message: failure.message });
      }
    } else {
      const failure = describeAiFailure(outcome.reason, { attemptId, submissionId, userId: user.id });
      failures.push({ submissionId, judge: null, message: failure.message });
    }
  });

  if (Object.keys(marks).length === 0) {
    // Surface the cause in words a candidate can act on (never the provider's details).
    throw new ApiError('AI_UNAVAILABLE', failures[0]?.message ?? 'The judges could not mark this attempt.');
  }
  const complete = Object.values(marks).every((mark) => mark.status === 'DONE') && failures.length === 0;
  return c.json({
    ok: true,
    marked: Object.keys(marks).length,
    status: complete ? 'DONE' : 'PARTIAL',
    marks,
    failures,
  });
};
router.post('/:id/ai-mark', aiMarkWriting);
// The first name of this endpoint, kept so a page cached by an older deploy still works.
router.post('/:id/ai-mark-writing', aiMarkWriting);

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
