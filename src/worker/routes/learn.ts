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
  setDailyGoal,
  setLearnLevel,
} from '../services/learn-service';
import { lookupWord } from '../services/dictionary-service';
import { DAY_PATTERN, LEARN_LEVELS, type LearnLevel } from '../../shared/learn';

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
  return c.json({ words: await getDueWords(c.env, user.id) });
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

learnRouter.put('/level', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ level: z.number().int() }));
  if (!LEARN_LEVELS.includes(body.level as LearnLevel)) throw ApiError.validation('Choose a level from 4 to 7.');
  await setLearnLevel(c.env, user.id, body.level as LearnLevel);
  return c.json({ ok: true });
});

learnRouter.put('/goal', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ goalXp: z.number().int().min(10).max(200) }));
  await setDailyGoal(c.env, user.id, body.goalXp);
  return c.json({ ok: true });
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
