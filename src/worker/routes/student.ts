import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { parseBody, parseQuery } from '../lib/validate';
import { assertCsrf } from '../lib/http';
import { newId, nowIso } from '../lib/ids';
import { ApiError } from '../lib/errors';
import {
  getStudentDashboard,
  getTaskTypePerformance,
  getTrends,
  listAttempts,
  listStudentAssignments,
} from '../services/analytics-service';
import { SKILLS, TEST_TYPES } from '../../shared/types';
import { backfillProjectedBands } from '../services/estimates-service';
import {
  VOCABULARY_MEANING_MAX,
  VOCABULARY_NOTE_MAX,
  VOCABULARY_SOURCE_MAX,
  VOCABULARY_TERM_MAX,
} from '../../shared/vocabulary';
import {
  deleteVocabularyEntry,
  listVocabulary,
  saveVocabularyEntry,
  updateVocabularyEntry,
} from '../services/vocabulary-service';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);

const filterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  skill: z.enum(SKILLS).optional(),
  testType: z.enum(TEST_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/dashboard', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  const dashboard = await getStudentDashboard(c.env, user.id, {
    from: filters.from ?? null,
    to: filters.to ?? null,
    skill: filters.skill ?? null,
    testType: filters.testType ?? null,
    limit: filters.limit ?? 60,
  });
  return c.json(dashboard);
});

router.get('/attempts', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  // Sets marked before short-set projection existed get their band here (idempotent, best effort).
  await backfillProjectedBands(c.env, user.id).catch(() => 0);
  const attempts = await listAttempts(c.env, user.id, {
    from: filters.from ?? null,
    to: filters.to ?? null,
    skill: filters.skill ?? null,
    testType: filters.testType ?? null,
    limit: filters.limit ?? 60,
  });
  return c.json({ attempts });
});

router.get('/assignments', async (c) => {
  const user = currentUser(c);
  const assignments = await listStudentAssignments(c.env, user.id);
  return c.json({ assignments });
});

router.get('/analytics', async (c) => {
  const user = currentUser(c);
  const filters = parseQuery(c, filterSchema);
  const [trends, taskTypes] = await Promise.all([
    getTrends(c.env, { ...filters, skill: filters.skill ?? null, testType: filters.testType ?? null }, user.id),
    getTaskTypePerformance(c.env, { ...filters, skill: filters.skill ?? null, testType: filters.testType ?? null }, user.id),
  ]);
  return c.json({ trends, taskTypes });
});

// ---------------------------------------------------------------- vocabulary
// The candidate's own word list, collected from passages, transcripts and
// explanation panels. Every route is scoped to the signed-in user.

const vocabularyEntrySchema = z.object({
  term: z.string().trim().min(1).max(VOCABULARY_TERM_MAX),
  meaning: z.string().max(VOCABULARY_MEANING_MAX).optional(),
  meaningVi: z.string().max(VOCABULARY_MEANING_MAX).optional(),
  pos: z.string().max(24).optional(),
  phonetic: z.string().max(80).optional(),
  example: z.string().max(VOCABULARY_NOTE_MAX).optional(),
  note: z.string().max(VOCABULARY_NOTE_MAX).nullish(),
  source: z.string().max(VOCABULARY_SOURCE_MAX).nullish(),
});

const vocabularyQuerySchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Everything this learner owns, as one JSON document (data export). */
/** One merged agenda: personal events + mentor sessions + classes + deadlines. */
router.get('/calendar', async (c) => {
  const user = currentUser(c);
  const from = c.req.query('from') ?? new Date().toISOString();
  const to = c.req.query('to') ?? new Date(Date.now() + 45 * 86400_000).toISOString();

  const personal = await c.env.DB.prepare(
    'SELECT id, title, note, starts_at, ends_at FROM calendar_events WHERE user_id = ? AND ends_at >= ? AND starts_at <= ? ORDER BY starts_at',
  )
    .bind(user.id, from, to)
    .all<{ id: string; title: string; note: string; starts_at: string; ends_at: string }>();

  const sessions = await c.env.DB.prepare(
    `SELECT s.id, s.topic, s.starts_at, s.ends_at, s.status, s.kind, s.mentor_id,
            COALESCE(NULLIF(pm.display_name, ''), um.username, 'Mentor') AS mentor_name,
            COALESCE(NULLIF(ps.display_name, ''), us.username, 'Student') AS student_name
       FROM mentor_sessions s
       JOIN users um ON um.id = s.mentor_id
       JOIN users us ON us.id = s.student_id
       LEFT JOIN user_profiles pm ON pm.user_id = s.mentor_id
       LEFT JOIN user_profiles ps ON ps.user_id = s.student_id
      WHERE (s.mentor_id = ? OR s.student_id = ?) AND s.status IN ('REQUESTED', 'SCHEDULED', 'ACTIVE')
        AND s.ends_at >= ? AND s.starts_at <= ?
      ORDER BY s.starts_at`,
  )
    .bind(user.id, user.id, from, to)
    .all<Record<string, string>>();

  const classes = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.starts_at, c.ends_at, c.status
       FROM mentor_classes c
      WHERE (c.mentor_id = ? OR EXISTS (SELECT 1 FROM mentor_class_members m WHERE m.class_id = c.id AND m.user_id = ?))
        AND c.ends_at >= ? AND c.starts_at <= ?
      ORDER BY c.starts_at`,
  )
    .bind(user.id, user.id, from, to)
    .all<Record<string, string>>();

  const deadlines = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.due_at
       FROM assignments a
       JOIN classroom_members m ON m.classroom_id = a.classroom_id AND m.user_id = ? AND m.status = 'ACTIVE'
      WHERE a.status = 'ACTIVE' AND a.due_at IS NOT NULL AND a.due_at >= ? AND a.due_at <= ?
      ORDER BY a.due_at`,
  )
    .bind(user.id, from, to)
    .all<{ id: string; title: string; due_at: string }>();

  const events = [
    ...personal.results.map((row) => ({
      kind: 'NOTE' as const,
      id: row.id,
      title: row.title,
      note: row.note,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    })),
    ...sessions.results.map((row) => ({
      kind: 'SESSION' as const,
      id: String(row.id),
      title: `${row.kind === 'CLASS' ? 'Class room' : 'Coaching'} · ${row.topic}`,
      note: row.mentor_id === user.id ? `with ${row.student_name}` : `with ${row.mentor_name}`,
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
    })),
    ...classes.results.map((row) => ({
      kind: 'CLASS' as const,
      id: String(row.id),
      title: String(row.title),
      note: 'Live class',
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
    })),
    ...deadlines.results.map((row) => ({
      kind: 'DEADLINE' as const,
      id: row.id,
      title: `Due · ${row.title}`,
      note: 'Assignment deadline',
      startsAt: row.due_at,
      endsAt: row.due_at,
    })),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return c.json({ events });
});

/** Add a personal calendar entry (study block, revision note…). */
router.post('/calendar', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().min(1).max(160),
      note: z.string().max(2000).optional(),
      startsAt: z.string().min(4).max(40),
      endsAt: z.string().min(4).max(40),
    }),
  );
  const id = newId('cal');
  await c.env.DB.prepare(
    'INSERT INTO calendar_events (id, user_id, title, note, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, body.title, body.note ?? '', body.startsAt, body.endsAt, nowIso())
    .run();
  return c.json({ event: { id, ...body, note: body.note ?? '' } }, 201);
});

/** Delete one of your own calendar entries. */
router.delete('/calendar/:eventId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const result = await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?')
    .bind(c.req.param('eventId'), user.id)
    .run();
  if (!result.meta.changes) throw ApiError.notFound('That entry does not exist.');
  return c.json({ ok: true });
});

router.get('/export', async (c) => {
  const user = currentUser(c);
  const profile = await c.env.DB.prepare(
    `SELECT u.email, u.username, u.role, u.created_at, p.display_name, p.target_band, p.timezone
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(user.id)
    .first();
  const attempts = await c.env.DB.prepare(
    `SELECT a.id, a.test_type, a.status, a.started_at, a.submitted_at, a.raw_score, a.total_questions,
            a.estimated_band, t.title AS test_title
       FROM attempts a LEFT JOIN test_versions v ON v.id = a.test_version_id
       LEFT JOIN tests t ON t.id = v.test_id
      WHERE a.user_id = ?
      ORDER BY a.started_at DESC`,
  )
    .bind(user.id)
    .all();
  const vocabulary = await c.env.DB.prepare('SELECT * FROM vocabulary_entries WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all();
  const learn = await c.env.DB.prepare('SELECT xp, streak, best_streak, coins FROM learn_profiles WHERE user_id = ?')
    .bind(user.id)
    .first();
  return c.json({
    exportedAt: new Date().toISOString(),
    profile,
    attempts: attempts.results,
    vocabulary: vocabulary.results,
    learn,
  });
});

router.get('/vocabulary', async (c) => {
  const user = currentUser(c);
  const query = parseQuery(c, vocabularyQuerySchema);
  const list = await listVocabulary(c.env, user.id, { search: query.search ?? null, limit: query.limit ?? 200 });
  return c.json(list);
});

router.post('/vocabulary', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, vocabularyEntrySchema);
  const entry = await saveVocabularyEntry(c.env, user.id, body);
  return c.json({ entry }, 201);
});

router.patch('/vocabulary/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      meaning: z.string().max(VOCABULARY_MEANING_MAX).optional(),
      note: z.string().max(VOCABULARY_NOTE_MAX).nullish(),
      reviewed: z.boolean().optional(),
      /** The verdict of a review: right moves the word up a Leitner box, wrong drops it. */
      correct: z.boolean().optional(),
    }),
  );
  const entry = await updateVocabularyEntry(c.env, user.id, c.req.param('id'), body);
  return c.json({ entry });
});

router.delete('/vocabulary/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await deleteVocabularyEntry(c.env, user.id, c.req.param('id'));
  return c.json({ ok: true });
});

export default router;
