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
  note: z.string().max(VOCABULARY_NOTE_MAX).nullish(),
  source: z.string().max(VOCABULARY_SOURCE_MAX).nullish(),
});

const vocabularyQuerySchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
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
