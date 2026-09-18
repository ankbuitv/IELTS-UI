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
  createAttempt,
  loadAttemptResult,
  loadCandidateAttemptState,
  recordIntegrityEvents,
  saveAnswers,
  saveWritingResponse,
  submitAttempt,
} from '../services/attempt-service';
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
