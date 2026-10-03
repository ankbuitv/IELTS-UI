import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { enforceRateLimit } from '../lib/rate-limit';
import { parseBody, parseQuery } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  completeLesson,
  completeReview,
  getDailyWords,
  getDueWords,
  getLearnOverview,
  getLearnBand,
  getReviewPool,
  setDailyGoal,
  setLearnBand,
} from '../services/learn-service';
import { getCatalogue, getLessonPlay } from '../services/learn-catalogue-service';
import { auditPlan, getPlan, rebuildPlan, setPlanItemStatus } from '../services/learn-plan-service';
import { buildPersonalLesson, latestPersonalLesson } from '../services/learn-generation-service';
import { lookupWord } from '../services/dictionary-service';
import { DAY_PATTERN, isLearnBand, type LearnBand, type PlanItemStatus } from '../../shared/learn';

/**
 * Learn path and dictionary API. Everything is scoped to the signed-in user.
 * Responses never mention which AI produced a word or a definition.
 */
export const learnRouter = new Hono<AppBindings>();
learnRouter.use('*', requireAuth);
learnRouter.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

const daySchema = z.string().regex(DAY_PATTERN);

learnRouter.get('/overview', async (c) => {
  const user = currentUser(c);
  const { day } = parseQuery(c, z.object({ day: daySchema }));
  return c.json(await getLearnOverview(c.env, user.id, day));
});

/**
 * The path: every band summarised, plus the lessons of one band.
 *
 * Lessons are rows, not bundle content, so the client fetches the path instead
 * of importing it. Without `band` the first band that has lessons is returned.
 */
learnRouter.get('/catalogue', async (c) => {
  const user = currentUser(c);
  const { band } = parseQuery(c, z.object({ band: z.coerce.number().optional() }));
  if (band !== undefined && !isLearnBand(band)) {
    throw ApiError.validation('Choose a band between 4.0 and 8.0.');
  }
  return c.json(await getCatalogue(c.env, user.id, (band ?? null) as LearnBand | null));
});

/** One lesson with the words the exercise engine needs to build it. */
learnRouter.get('/lessons/:id', async (c) => {
  const user = currentUser(c);
  const lesson = await getLessonPlay(c.env, user.id, c.req.param('id'));
  if (!lesson) throw ApiError.notFound('That lesson does not exist.');
  return c.json({ lesson });
});

learnRouter.post('/lessons/complete', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      lessonId: z.string().min(1).max(40),
      correct: z.number().int().min(0).max(40),
      total: z.number().int().min(1).max(40),
      mistakes: z.array(z.string().max(80)).max(40).default([]),
      day: daySchema,
    }),
  );
  return c.json(await completeLesson(c.env, user.id, body));
});

learnRouter.get('/review', async (c) => {
  const user = currentUser(c);
  const [words, pool] = await Promise.all([getDueWords(c.env, user.id), getReviewPool(c.env, user.id)]);
  return c.json({ words, pool });
});

learnRouter.post('/review/complete', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      results: z.array(z.object({ id: z.string().min(1).max(60), correct: z.boolean() })).min(1).max(40),
      day: daySchema,
    }),
  );
  return c.json(await completeReview(c.env, user.id, body));
});

learnRouter.post('/daily-words', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ day: daySchema, extra: z.boolean().optional() }));
  await enforceRateLimit(
    c.env,
    { bucket: `learn-words:${user.id}`, windowSeconds: 3600, limit: body.extra ? 6 : 20 },
    'You have asked for new words several times. Try again in a little while.',
  );
  return c.json(await getDailyWords(c.env, user.id, body));
});

/** Places the learner on a rung of the 4.0–8.0 ladder. Half bands only. */
learnRouter.put('/band', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ band: z.number().min(4).max(8) }));
  if (!isLearnBand(body.band)) throw ApiError.validation('Choose a band from 4.0 to 8.0 in half bands.');
  await setLearnBand(c.env, user.id, body.band);
  return c.json({ ok: true });
});

learnRouter.put('/goal', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ goalXp: z.number().int().min(10).max(200) }));
  await setDailyGoal(c.env, user.id, body.goalXp);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ study plan
const planRequestSchema = z.object({
  targetBand: z.number().min(4).max(8),
  examDay: z.string().regex(DAY_PATTERN).nullable().optional(),
  minutesPerDay: z.number().int().min(5).max(180).default(30),
});

/** The learner's active plan, or null when they have never built one. */
learnRouter.get('/plan', async (c) => {
  const user = currentUser(c);
  const { day } = parseQuery(c, z.object({ day: daySchema }));
  return c.json({ plan: await getPlan(c.env, user.id, day) });
});

/**
 * Builds a plan and makes it the active one.
 *
 * Deliberately manual: a plan that quietly rearranged itself every time a test
 * was marked would move the learner's ticks onto different lessons, and nobody
 * can follow a route that keeps changing under them.
 */
learnRouter.post('/plan', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, planRequestSchema);
  if (!isLearnBand(body.targetBand)) throw ApiError.validation('Choose a target band from 4.0 to 8.0 in half bands.');
  await enforceRateLimit(
    c.env,
    { bucket: `learn-plan:${user.id}`, windowSeconds: 3600, limit: 10 },
    'You have rebuilt your plan several times. Try again in a little while.',
  );
  const { day } = parseQuery(c, z.object({ day: daySchema }));
  const input = {
    targetBand: body.targetBand as LearnBand,
    examDay: body.examDay ?? null,
    minutesPerDay: body.minutesPerDay,
  };
  const plan = await rebuildPlan(c.env, user.id, input, day);
  await auditPlan(c.env, user.id, plan.id, input);
  return c.json({ plan });
});

learnRouter.post('/plan/items/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ status: z.enum(['PENDING', 'DONE', 'SKIPPED']) }));
  return c.json({ item: await setPlanItemStatus(c.env, user.id, c.req.param('id'), body.status as PlanItemStatus) });
});

// ------------------------------------------------- a lesson from your mistakes
/** The learner's most recent revision lesson, and whether it was made today. */
learnRouter.get('/personal-lesson', async (c) => {
  const user = currentUser(c);
  const { day } = parseQuery(c, z.object({ day: daySchema }));
  const latest = await latestPersonalLesson(c.env, user.id);
  return c.json({ lesson: latest ? { ...latest, today: latest.createdAt.slice(0, 10) === day } : null });
});

/**
 * Builds a private revision lesson from the words this learner keeps missing.
 *
 * Rate limited hard: it is an AI call per request, and one lesson a day is more
 * than enough revision.
 */
learnRouter.post('/personal-lesson', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const { day } = await parseBody(c, z.object({ day: daySchema }));
  await enforceRateLimit(
    c.env,
    { bucket: `learn-personal:${user.id}`, windowSeconds: 3600, limit: 3 },
    'You have already built a revision lesson today. Come back tomorrow.',
  );
  const band = await getLearnBand(c.env, user.id);
  const lesson = await buildPersonalLesson(c.env, user.id, band);
  return c.json({ ...lesson, day });
});

export const dictionaryRouter = new Hono<AppBindings>();
dictionaryRouter.use('*', requireAuth);
dictionaryRouter.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

dictionaryRouter.get('/lookup', async (c) => {
  const user = currentUser(c);
  const { term } = parseQuery(c, z.object({ term: z.string().min(1).max(80) }));
  await enforceRateLimit(
    c.env,
    { bucket: `dictionary:${user.id}`, windowSeconds: 3600, limit: 120 },
    'You have looked up many words in a short time. Try again in a little while.',
  );
  const outcome = await lookupWord(c.env, user.id, term);
  if (!outcome.entry) {
    return c.json({ entry: null, message: outcome.unavailable ?? 'No entry was found for that word.' }, outcome.unavailable ? 503 : 404);
  }
  return c.json({ entry: outcome.entry });
});
