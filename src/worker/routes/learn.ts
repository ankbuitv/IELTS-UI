import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { sha256Hex } from '../lib/crypto';
import { nowIso } from '../lib/ids';
import { SERVER_SPEECH_VOICES, synthesizeSpeechWithProvider } from '../ai/providers';
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
import { getShopState, purchaseItem, useItem } from '../services/learn-shop-service';
import { getLeaderboard } from '../services/learn-leaderboard-service';
import { translateSentence } from '../services/learn-translate-service';
import { auditPlan, getPlan, rebuildPlan, setPlanItemStatus } from '../services/learn-plan-service';
import { buildPersonalLesson, latestPersonalLesson } from '../services/learn-generation-service';
import { getEverydayLessons } from '../services/learn-everyday-service';
import {
  acceptFriendRequest,
  getFriendOverview,
  getGamificationProfile,
  getPublicPlayerProfile,
  removeFriend,
  searchPlayers,
  sendFriendRequest,
  updateGamificationIdentity,
} from '../services/learn-social-service';
import { lookupWord } from '../services/dictionary-service';
import { DAY_PATTERN, isLearnBand, isPlausibleDay, type LearnBand, type PlanItemStatus } from '../../shared/learn';
import { isShopItemKey, type ShopItemKey } from '../../shared/shop';
import { isLeaderboardScope, isLeaderboardWindow, type LeaderboardScope, type LeaderboardWindow } from '../../shared/leaderboard';

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

// -------------------------------------------------- player profiles / friends
learnRouter.get('/profile', async (c) => {
  const user = currentUser(c);
  return c.json({ profile: await getGamificationProfile(c.env, user.id) });
});

learnRouter.patch('/profile', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      avatarId: z.string().max(32).optional(),
      nameEffect: z.string().max(32).optional(),
      profileEffect: z.string().max(32).optional(),
    }).refine((value) => Object.keys(value).length > 0, 'Choose at least one profile setting to save.'),
  );
  return c.json({ profile: await updateGamificationIdentity(c.env, user.id, body) });
});

learnRouter.get('/profiles/:userId', async (c) => {
  const user = currentUser(c);
  return c.json({ profile: await getPublicPlayerProfile(c.env, user.id, c.req.param('userId')) });
});

learnRouter.get('/friends', async (c) => {
  const user = currentUser(c);
  return c.json(await getFriendOverview(c.env, user.id));
});

learnRouter.get('/people/search', async (c) => {
  const user = currentUser(c);
  const { q } = parseQuery(c, z.object({ q: z.string().trim().max(60).default('') }));
  await enforceRateLimit(
    c.env,
    { bucket: `learn-people-search:${user.id}`, windowSeconds: 3600, limit: 120 },
    'You have searched for people several times. Try again in a little while.',
  );
  return c.json({ results: await searchPlayers(c.env, user.id, q) });
});

learnRouter.post('/friends/:userId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await sendFriendRequest(c.env, user.id, c.req.param('userId'));
  return c.json({ ok: true });
});

learnRouter.post('/friends/:userId/accept', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await acceptFriendRequest(c.env, user.id, c.req.param('userId'));
  return c.json({ ok: true });
});

learnRouter.delete('/friends/:userId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await removeFriend(c.env, user.id, c.req.param('userId'));
  return c.json({ ok: true });
});

learnRouter.get('/overview', async (c) => {
  const user = currentUser(c);
  const { day } = parseQuery(c, z.object({ day: daySchema }));
  return c.json(await getLearnOverview(c.env, user.id, day));
});

/** Generates (once) six private, ordered lessons for this learner and band. */
learnRouter.post('/everyday', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ band: z.number().min(4).max(8), day: daySchema }));
  if (!isLearnBand(body.band)) throw ApiError.validation('Choose a band from 4.0 to 8.0 in half bands.');
  if (!isPlausibleDay(body.day)) throw ApiError.validation('That calendar day is not valid.');
  await enforceRateLimit(
    c.env,
    { bucket: `learn-everyday:${user.id}:${body.band}`, windowSeconds: 3600, limit: 60 },
    'You have opened Everyday Lessons many times. Try again in a little while.',
  );
  return c.json(await getEverydayLessons(c.env, user.id, body.band as LearnBand, body.day));
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

// ----------------------------------------------------------- shop and coins
/** The shelf: the catalogue, the prices and what this learner holds. */
learnRouter.get('/shop', async (c) => {
  const user = currentUser(c);
  return c.json(await getShopState(c.env, user.id));
});

/**
 * Buys an item with coins.
 *
 * Rate limited generously rather than tightly: a learner buying three hints in
 * a row is normal, and each call is one conditional UPDATE. Nothing here trusts
 * a price or a balance from the client — it sends a key and the server prices it.
 */
learnRouter.post('/shop/buy', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ key: z.string().min(1).max(32), quantity: z.number().int().min(1).max(5).default(1) }),
  );
  if (!isShopItemKey(body.key)) throw ApiError.validation('That item is not in the shop.');
  await enforceRateLimit(
    c.env,
    { bucket: `learn-shop:${user.id}`, windowSeconds: 3600, limit: 60 },
    'That is a lot of shopping in one hour. Take a lesson first.',
  );
  return c.json(await purchaseItem(c.env, user.id, body.key as ShopItemKey, body.quantity));
});

/** Spends one item: a heart refill mid-lesson, a hint, or the double-XP switch. */
learnRouter.post('/items/use', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ key: z.string().min(1).max(32) }));
  if (!isShopItemKey(body.key)) throw ApiError.validation('That item is not in the shop.');
  await enforceRateLimit(
    c.env,
    { bucket: `learn-items:${user.id}`, windowSeconds: 3600, limit: 90 },
    'You have used a lot of items this hour. Try again in a little while.',
  );
  return c.json(await useItem(c.env, user.id, body.key as ShopItemKey));
});

// ------------------------------------------------------------- leaderboards
/** One board, week or all time, with the reader's own row. */
learnRouter.get('/leaderboard', async (c) => {
  const user = currentUser(c);
  const query = parseQuery(
    c,
    z.object({
      scope: z.string().default('learn'),
      window: z.string().default('week'),
      day: daySchema,
    }),
  );
  if (!isLeaderboardScope(query.scope)) throw ApiError.validation('That leaderboard does not exist.');
  if (!isLeaderboardWindow(query.window)) throw ApiError.validation('Choose this week or all time.');
  return c.json(
    await getLeaderboard(c.env, user.id, query.scope as LeaderboardScope, query.window as LeaderboardWindow, query.day),
  );
});

// ---------------------------------------------------------------- translation
/**
 * Vietnamese for one English sentence, cached.
 *
 * Cheap enough to call automatically after every answer; the cache means the
 * second learner to meet a sentence pays nothing. A provider that is down
 * answers with `available: false` rather than an error, because the sentence on
 * screen is the answer and this is only the gloss.
 */
learnRouter.post('/translate', async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, z.object({ text: z.string().trim().min(1).max(400) }));
  await enforceRateLimit(
    c.env,
    { bucket: `learn-translate:${user.id}`, windowSeconds: 3600, limit: 240 },
    'That is a lot of sentences in one hour. Try again in a little while.',
  );
  return c.json(await translateSentence(c.env, body.text));
});

// ----------------------------------------------------- generated practice audio
/**
 * The voices a configured provider can actually speak with. Empty when there is
 * no provider, so the client then offers only the device's own voices.
 */
learnRouter.get('/speech/voices', async (c) => {
  try {
    await synthesizeSpeechWithProvider(c.env, 'ping', 'nova');
    return c.json({ voices: [...SERVER_SPEECH_VOICES] });
  } catch {
    return c.json({ voices: [] });
  }
});

/**
 * Speaks a word or short sentence with a provider voice, cached.
 *
 * The first request for a (voice, text) pair pays the provider and the latency;
 * the result is stored and every later request streams the identical bytes, so
 * a word sounds the same on every device. Without a provider this is
 * AI_UNAVAILABLE and the client falls back to its own speech engine.
 */
learnRouter.get('/speech', async (c) => {
  const user = currentUser(c);
  const { text, voice } = parseQuery(
    c,
    z.object({ text: z.string().trim().min(1).max(200), voice: z.string().min(1).max(24).default('nova') }),
  );
  const hash = await sha256Hex(text.toLowerCase());
  const key = `${voice}:${hash}`;

  const hit = await c.env.DB.prepare('SELECT data_b64, mime FROM speech_cache WHERE cache_key = ?')
    .bind(key)
    .first<{ data_b64: string; mime: string }>();
  if (hit) {
    return c.body(Buffer.from(hit.data_b64, 'base64'), 200, {
      'content-type': hit.mime,
      'cache-control': 'public, max-age=31536000',
    });
  }

  await enforceRateLimit(
    c.env,
    { bucket: `learn-speech:${user.id}`, windowSeconds: 3600, limit: 200 },
    'That is a lot of audio in a short time. Try again in a little while.',
  );
  const { bytes, mime } = await synthesizeSpeechWithProvider(c.env, text, voice);
  const base64 = Buffer.from(new Uint8Array(bytes)).toString('base64');
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO speech_cache (cache_key, voice, text_hash, mime, data_b64, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(key, voice, hash, mime, base64, bytes.byteLength, nowIso())
    .run();

  return c.body(new Uint8Array(bytes), 200, {
    'content-type': mime,
    'cache-control': 'public, max-age=31536000',
  });
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
