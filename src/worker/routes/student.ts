import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { parseBody, parseQuery } from '../lib/validate';
import { assertCsrf } from '../lib/http';
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
