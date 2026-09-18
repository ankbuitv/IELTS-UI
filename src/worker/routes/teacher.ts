import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp } from '../lib/http';
import { parseBody } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import {
  acceptClassroomInvite,
  addMemberByEmail,
  archiveAssignment,
  createAssignment,
  createClassroom,
  createClassroomInvite,
  getAssignmentDetail,
  listAssignmentsForClassroom,
  listClassroomMembers,
  listClassroomsForTeacher,
  listInvites,
  removeMember,
  requireClassroomAccess,
  requireStudentAccess,
  revokeInvite,
  updateAssignment,
  updateClassroom,
} from '../services/teacher-service';
import { getClassroomAnalytics, getSkillPerformance, getTaskTypePerformance, getTrends, listAttempts } from '../services/analytics-service';
import { buildResultView } from '../services/attempt-service';
import { listWritingQueue, markQuestionManually, setWritingScore } from '../services/marking-service';
import { recordAudit } from '../lib/audit';
import { EXAM_MODES, RESULT_VISIBILITIES, TIMING_POLICIES } from '../../shared/types';

const router = new Hono<AppBindings>();

router.use('*', requireAuth, requireRole('TEACHER', 'ADMIN'));
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

// ---------------------------------------------------------------------------
// Classrooms
// ---------------------------------------------------------------------------
router.get('/classrooms', async (c) => {
  const user = currentUser(c);
  return c.json({ classrooms: await listClassroomsForTeacher(c.env, user) });
});

router.post('/classrooms', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional() }),
  );
  const classroom = await createClassroom(c.env, user, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_CREATE',
    entityType: 'classroom',
    entityId: classroom.id,
    ip: clientIp(c),
  });
  return c.json({ classroom }, 201);
});

router.get('/classrooms/:id', async (c) => {
  const user = currentUser(c);
  const classroomId = c.req.param('id');
  const classroom = await requireClassroomAccess(c.env, user, classroomId);
  const [members, assignments, invites, analytics] = await Promise.all([
    listClassroomMembers(c.env, classroomId),
    listAssignmentsForClassroom(c.env, classroomId),
    listInvites(c.env, classroomId),
    getClassroomAnalytics(c.env, classroomId),
  ]);
  return c.json({
    classroom: {
      id: classroom.id,
      name: classroom.name,
      status: classroom.status,
      isOwner: classroom.teacher_id === user.id,
    },
    members,
    assignments,
    invites,
    analytics,
  });
});

router.patch('/classrooms/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    }),
  );
  await updateClassroom(c.env, user, c.req.param('id'), body);
  return c.json({ ok: true });
});

router.post('/classrooms/:id/archive', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await updateClassroom(c.env, user, c.req.param('id'), { status: 'ARCHIVED' });
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_ARCHIVE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------
router.get('/classrooms/:id/members', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  return c.json({ members: await listClassroomMembers(c.env, c.req.param('id')) });
});

router.post('/classrooms/:id/invites', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
      ttlHours: z.number().int().min(1).max(720).optional(),
    }),
  );
  const invite = await createClassroomInvite(c.env, user, c.req.param('id'), body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_INVITE_CREATE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    metadata: { inviteId: invite.inviteId, email: invite.email },
    ip: clientIp(c),
  });

  const base = (c.env.APP_BASE_URL || 'https://ielts.ankb.qzz.io').replace(/\/$/, '');
  return c.json({
    invite,
    shareUrl: `${base}/join?token=${encodeURIComponent(invite.token)}`,
  }, 201);
});

router.delete('/classrooms/:id/invites/:inviteId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await revokeInvite(c.env, user, c.req.param('id'), c.req.param('inviteId'));
  return c.json({ ok: true });
});

router.post('/classrooms/:id/members', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ email: z.string().trim().toLowerCase().email().max(254) }));
  const member = await addMemberByEmail(c.env, user, c.req.param('id'), body.email);
  return c.json({ member }, 201);
});

router.delete('/classrooms/:id/members/:userId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await removeMember(c.env, user, c.req.param('id'), c.req.param('userId'));
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_MEMBER_REMOVE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    metadata: { removedUserId: c.req.param('userId') },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/** Accepting an invitation as a teacher/co-teacher (students use /classrooms/join). */
router.post('/invites/accept', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ token: z.string().min(10).max(200) }));
  const result = await acceptClassroomInvite(c.env, user, body.token);
  return c.json({ ok: true, ...result });
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
const assignmentSchema = z.object({
  classroomId: z.string().min(1),
  testVersionId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  instructions: z.string().max(4000).optional(),
  startAt: z.string().datetime().nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  timingPolicy: z.enum(TIMING_POLICIES).optional(),
  customDurationSeconds: z.number().int().min(60).max(36_000).nullable().optional(),
  mode: z.enum(EXAM_MODES).optional(),
  integrityOverrides: z.record(z.string(), z.union([z.boolean(), z.number(), z.null()])).optional(),
  resultVisibility: z.enum(RESULT_VISIBILITIES).optional(),
  publish: z.boolean().optional(),
});

router.post('/assignments', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, assignmentSchema);
  const result = await createAssignment(c.env, user, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'ASSIGNMENT_CREATE',
    entityType: 'assignment',
    entityId: result.assignmentId,
    metadata: { classroomId: body.classroomId, testVersionId: body.testVersionId, mode: body.mode },
    ip: clientIp(c),
  });
  return c.json(result, 201);
});

router.get('/assignments/:id', async (c) => {
  const user = currentUser(c);
  return c.json(await getAssignmentDetail(c.env, user, c.req.param('id')));
});

router.patch('/assignments/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, assignmentSchema.partial().omit({ classroomId: true, testVersionId: true }));
  await updateAssignment(c.env, user, c.req.param('id'), body);
  return c.json({ ok: true });
});

router.delete('/assignments/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await archiveAssignment(c.env, user, c.req.param('id'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Students & reports
// ---------------------------------------------------------------------------
router.get('/students/:userId', async (c) => {
  const user = currentUser(c);
  const studentId = c.req.param('userId');
  await requireStudentAccess(c.env, user, studentId);

  const profile = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.last_login_at, u.status, p.display_name, p.target_band
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(studentId)
    .first<{
      id: string;
      email: string;
      created_at: string;
      last_login_at: string | null;
      status: string;
      display_name: string | null;
      target_band: number | null;
    }>();
  if (!profile) throw ApiError.notFound('Student not found.');

  const [attempts, skillPerformance, trends, taskTypes, writing, classrooms] = await Promise.all([
    listAttempts(c.env, studentId, { limit: 100 }),
    getSkillPerformance(c.env, {}, studentId),
    getTrends(c.env, { skill: null, testType: null }, studentId),
    getTaskTypePerformance(c.env, {}, studentId),
    c.env.DB.prepare(
      `SELECT w.id, w.attempt_id, t.title AS test_title, w.task_label, w.word_count, w.submitted_at,
              w.response_text, w.prompt_snapshot, ws.band, ws.feedback, ws.scoring_source, ws.criteria_json
         FROM writing_submissions w
         JOIN attempts a ON a.id = w.attempt_id
         JOIN tests t ON t.id = a.test_id
         LEFT JOIN writing_scores ws ON ws.writing_submission_id = w.id
        WHERE a.user_id = ? AND TRIM(w.response_text) != ''
        ORDER BY w.created_at DESC LIMIT 50`,
    )
      .bind(studentId)
      .all<{
        id: string;
        attempt_id: string;
        test_title: string;
        task_label: string;
        word_count: number;
        submitted_at: string | null;
        response_text: string;
        prompt_snapshot: string | null;
        band: number | null;
        feedback: string | null;
        scoring_source: string | null;
        criteria_json: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT c.id, c.name FROM classrooms c
        JOIN classroom_members m ON m.classroom_id = c.id AND m.user_id = ? AND m.status = 'ACTIVE'
       WHERE c.teacher_id = ? OR EXISTS (SELECT 1 FROM classroom_members ct WHERE ct.classroom_id = c.id AND ct.user_id = ? AND ct.role = 'CO_TEACHER' AND ct.status = 'ACTIVE')`,
    )
      .bind(studentId, user.id, user.id)
      .all<{ id: string; name: string }>(),
  ]);

  const integrityRows = await c.env.DB.prepare(
    `SELECT x.id AS attempt_id,
            SUM(CASE WHEN e.type IN ('TAB_HIDDEN','FULLSCREEN_EXIT') THEN 1 ELSE 0 END) AS counted,
            COUNT(e.id) AS total
       FROM attempts x LEFT JOIN integrity_events e ON e.attempt_id = x.id
      WHERE x.user_id = ?
      GROUP BY x.id`,
  )
    .bind(studentId)
    .all<{ attempt_id: string; counted: number | null; total: number }>();
  const integrityByAttempt = new Map(integrityRows.results.map((row) => [row.attempt_id, row]));

  return c.json({
    student: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name ?? profile.email,
      createdAt: profile.created_at,
      lastLoginAt: profile.last_login_at,
      status: profile.status,
      targetBand: profile.target_band,
    },
    classrooms: classrooms.results,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      integrityCounted: integrityByAttempt.get(attempt.attemptId)?.counted ?? 0,
      integrityTotal: integrityByAttempt.get(attempt.attemptId)?.total ?? 0,
    })),
    skillPerformance,
    trends,
    taskTypes,
    writing: writing.results.map((row) => ({
      submissionId: row.id,
      attemptId: row.attempt_id,
      testTitle: row.test_title,
      taskLabel: row.task_label,
      wordCount: row.word_count,
      submittedAt: row.submitted_at,
      responseText: row.response_text,
      prompt: row.prompt_snapshot ?? '',
      scoreBand: row.band,
      feedback: row.feedback ?? '',
      scoringSource: row.scoring_source,
      criteria: (() => {
        try {
          return row.criteria_json ? (JSON.parse(row.criteria_json) as Record<string, number>) : {};
        } catch {
          return {};
        }
      })(),
    })),
  });
});

/** Full attempt view for an authorized teacher, including question-level review. */
router.get('/attempts/:attemptId', async (c) => {
  const user = currentUser(c);
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(c.req.param('attemptId'))
    .first<import('../services/attempt-service').AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');

  await requireStudentAccess(c.env, user, attempt.user_id);
  const view = await buildResultView(c.env, attempt, { includeReview: true, viewerIsStaff: true });
  return c.json(view);
});

router.get('/classrooms/:id/analytics', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  return c.json(await getClassroomAnalytics(c.env, c.req.param('id')));
});

router.get('/classrooms/:id/students', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  const members = await listClassroomMembers(c.env, c.req.param('id'));
  const studentIds = members.filter((m) => m.role === 'STUDENT' && m.status === 'ACTIVE').map((m) => m.userId);
  if (studentIds.length === 0) return c.json({ students: [] });

  const stats = await c.env.DB.prepare(
    `SELECT a.user_id,
            COUNT(*) AS attempts,
            SUM(CASE WHEN a.status IN ('SUBMITTED','EXPIRED') THEN 1 ELSE 0 END) AS submitted,
            AVG(CASE WHEN a.status IN ('SUBMITTED','EXPIRED') THEN a.raw_score END) AS avg_raw,
            AVG(a.estimated_band) AS avg_band,
            MAX(a.estimated_band) AS best_band
       FROM attempts a
      WHERE a.user_id IN (${studentIds.map(() => '?').join(',')})
        AND a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)
      GROUP BY a.user_id`,
  )
    .bind(...studentIds, c.req.param('id'))
    .all<{
      user_id: string;
      attempts: number;
      submitted: number;
      avg_raw: number | null;
      avg_band: number | null;
      best_band: number | null;
    }>();

  const statsByUser = new Map(stats.results.map((row) => [row.user_id, row]));

  return c.json({
    students: members
      .filter((member) => member.role === 'STUDENT')
      .map((member) => ({
        ...member,
        attempts: statsByUser.get(member.userId)?.attempts ?? 0,
        submitted: statsByUser.get(member.userId)?.submitted ?? 0,
        averageRawScore:
          statsByUser.get(member.userId)?.avg_raw !== undefined && statsByUser.get(member.userId)!.avg_raw !== null
            ? Math.round(statsByUser.get(member.userId)!.avg_raw! * 10) / 10
            : null,
        averageBand:
          statsByUser.get(member.userId)?.avg_band != null
            ? Math.round(statsByUser.get(member.userId)!.avg_band! * 2) / 2
            : null,
        bestBand: statsByUser.get(member.userId)?.best_band ?? null,
      })),
  });
});


router.get('/writing-queue', async (c) => {
  const user = currentUser(c);
  const unmarkedOnly = c.req.query('unmarked') === '1' || c.req.query('unmarked') === 'true';
  return c.json(await listWritingQueue(c.env, user, { unmarkedOnly }));
});

router.post('/attempts/:attemptId/question-marks', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const attemptId = c.req.param('attemptId');
  const attempt = await c.env.DB.prepare('SELECT id, user_id FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<{ id: string; user_id: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  await requireStudentAccess(c.env, user, attempt.user_id);

  const body = await parseBody(
    c,
    z.object({
      questionId: z.string().min(1).max(64),
      isCorrect: z.boolean().nullable(),
      points: z.number().min(0).max(20).nullable().optional(),
    }),
  );
  const totals = await markQuestionManually(c.env, attemptId, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'QUESTION_MARK_SET',
    entityType: 'attempt',
    entityId: attemptId,
    metadata: { questionId: body.questionId, isCorrect: body.isCorrect },
    ip: clientIp(c),
  });
  return c.json({ ok: true, ...totals });
});

router.post('/writing-scores', async (c) => {
  const user = currentUser(c);
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

  const submission = await c.env.DB.prepare(
    `SELECT w.id, a.user_id FROM writing_submissions w JOIN attempts a ON a.id = w.attempt_id WHERE w.id = ?`,
  )
    .bind(body.writingSubmissionId)
    .first<{ id: string; user_id: string }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');
  await requireStudentAccess(c.env, user, submission.user_id);

  const result = await setWritingScore(c.env, {
    writingSubmissionId: body.writingSubmissionId,
    band: body.band,
    feedback: body.feedback,
    criteria: body.criteria,
    source: 'TEACHER',
    scoredBy: user.id,
  });
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'WRITING_SCORE_SET',
    entityType: 'writing_submission',
    entityId: body.writingSubmissionId,
    metadata: { band: body.band, attemptId: result.attemptId },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

export default router;
