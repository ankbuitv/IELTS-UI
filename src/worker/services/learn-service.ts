import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { buildVocabMessages } from '../ai/coach-prompts';
import { levelHintForUser } from './ai-marking-service';
import { saveAiVocabulary, updateVocabularyEntry, type SuggestedWord } from './vocabulary-service';
import { getLessonForCompletion, wordPool } from './learn-catalogue-service';
import { coinStatements, questCounters, readQuests, readWallet, settleQuests } from './learn-shop-service';
import { WORD_BANK } from '../../shared/learn-content';
import { seededRandom, shuffle } from '../../shared/learn-engine';
import {
  LEARN_BAND_DEFAULT,
  XP_REVIEW_PER_WORD,
  bandForEstimate,
  isPlausibleDay,
  lessonXp,
  starsFor,
  type DailyWordsResult,
  type LearnBand,
  type LearnOverview,
  type LearnProfile,
  type LearnProgressItem,
  type LessonCompletionInput,
  type LessonCompletionResult,
  type LessonWord,
  type ReviewCompletionResult,
  type ReviewResultInput,
} from '../../shared/learn';
import {
  DAILY_LOGIN_COINS,
  applyBoost,
  coinsForLesson,
  coinsForReview,
  streakWithFreeze,
} from '../../shared/shop';

/**
 * Learn path service.
 *
 * What is trusted lives here: XP, the streak, the daily goal and lesson stars.
 * The exercises are generated on the device, so the server only validates the
 * lesson against the catalogue and the plausibility of what the client reports
 * (never more correct answers than exercises, a calendar day near today). A
 * learner can only ever inflate their own numbers, which no one else sees.
 */
interface ProfileRow {
  user_id: string;
  xp: number;
  streak: number;
  best_streak: number;
  last_active_day: string | null;
  daily_goal_xp: number;
  start_band: number | null;
  band_source: string;
  last_words_day: string | null;
  coins: number;
  xp_boost_until: string;
}

const DAILY_WORD_COUNT = 5;
export const DAILY_WORDS_SOURCE = 'Daily words';
const MAX_EXERCISES = 40;

async function ensureProfile(env: Env, userId: string): Promise<ProfileRow> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO learn_profiles (user_id, xp, streak, best_streak, daily_goal_xp, created_at, updated_at)
     VALUES (?, 0, 0, 0, 30, ?, ?)`,
  )
    .bind(userId, now, now)
    .run();
  const row = await env.DB.prepare(
    `SELECT user_id, xp, streak, best_streak, last_active_day, daily_goal_xp, start_band, band_source, last_words_day,
            coins, xp_boost_until
       FROM learn_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<ProfileRow>();
  if (!row) throw new ApiError('INTERNAL', 'Your learning profile could not be created.');
  return row;
}

/**
 * Where the learner sits on the 4.0–8.0 ladder.
 *
 * A band they picked themselves wins over an estimate, because a candidate who
 * says "I am a 6" knows their own aim better than the last six tests do.
 * `band_source` tells the two apart now that either may be any half band;
 * rows written before that column existed carry an empty source and still read
 * as chosen.
 */
async function resolveBand(
  env: Env,
  userId: string,
  row: ProfileRow,
): Promise<{ band: LearnBand; source: LearnProfile['bandSource']; estimate: number | null }> {
  if (row.start_band !== null && row.band_source !== 'ESTIMATED') {
    return { band: bandForEstimate(row.start_band), source: 'CHOSEN', estimate: row.start_band };
  }
  const estimate = await levelHintForUser(env, userId).catch(() => null);
  if (estimate !== null) return { band: bandForEstimate(estimate), source: 'ESTIMATED', estimate };
  if (row.start_band !== null) {
    return { band: bandForEstimate(row.start_band), source: 'DEFAULT', estimate: row.start_band };
  }
  return { band: LEARN_BAND_DEFAULT, source: 'DEFAULT', estimate: null };
}

async function xpOnDay(env: Env, userId: string, day: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS total FROM learn_xp_log WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function toProfile(env: Env, userId: string, row: ProfileRow, day: string): Promise<LearnProfile> {
  const placement = await resolveBand(env, userId, row);
  const wallet = await readWallet(env, userId);
  return {
    xp: row.xp,
    streak: row.streak,
    bestStreak: row.best_streak,
    dailyGoalXp: row.daily_goal_xp,
    todayXp: await xpOnDay(env, userId, day),
    lastActiveDay: row.last_active_day,
    band: placement.band,
    bandSource: placement.source,
    startBand: placement.estimate,
    coins: wallet.coins,
    xpBoostUntil: wallet.xpBoostUntil,
    inventory: wallet.inventory,
  };
}

/** Whole days between two calendar days; 1 means "yesterday". */
function dayGap(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function requireDay(day: string): string {
  if (!isPlausibleDay(day)) throw ApiError.validation('That calendar day is not valid.');
  return day;
}

export async function getLearnOverview(env: Env, userId: string, dayInput: string): Promise<LearnOverview> {
  const day = requireDay(dayInput);
  const row = await ensureProfile(env, userId);
  const profile = await toProfile(env, userId, row, day);

  const done = await env.DB.prepare(
    'SELECT lesson_id, stars, best_accuracy, completions FROM learn_lessons_done WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ lesson_id: string; stars: number; best_accuracy: number; completions: number }>();
  const progress: Record<string, LearnProgressItem> = {};
  for (const item of done.results ?? []) {
    progress[item.lesson_id] = { stars: item.stars, bestAccuracy: item.best_accuracy, completions: item.completions };
  }

  const due = await env.DB.prepare(
    `SELECT COUNT(*) AS due FROM vocabulary_entries
      WHERE user_id = ? AND meaning != '' AND (due_at IS NULL OR due_at <= ?)`,
  )
    .bind(userId, nowIso())
    .first<{ due: number }>();

  const start = shiftDay(day, -6);
  const weekRows = await env.DB.prepare(
    'SELECT day, SUM(xp) AS xp FROM learn_xp_log WHERE user_id = ? AND day >= ? AND day <= ? GROUP BY day',
  )
    .bind(userId, start, day)
    .all<{ day: string; xp: number }>();
  const byDay = new Map((weekRows.results ?? []).map((item) => [item.day, item.xp]));
  const week = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDay(start, index);
    return { day: key, xp: byDay.get(key) ?? 0 };
  });

  // Quests are settled on read as well as on completion: a learner who finishes
  // a lesson, closes the tab before the finish screen loads and comes back the
  // next morning should still have been paid for yesterday's work.
  const counters = await questCounters(env, userId, day, profile.todayXp, profile.dailyGoalXp);
  const settled = await settleQuests(env, userId, day, counters);
  const quests = await readQuests(env, userId, day, counters);
  const withCoins = settled.coins > 0 ? await toProfile(env, userId, await ensureProfile(env, userId), day) : profile;

  return {
    profile: withCoins,
    progress,
    dueWords: due?.due ?? 0,
    dailyWordsDone: row.last_words_day === day,
    week,
    quests,
    coinsFromQuests: settled.coins,
  };
}

/** Places the learner on a rung of the ladder, overriding any estimate. */
export async function setLearnBand(env: Env, userId: string, band: LearnBand): Promise<void> {
  await ensureProfile(env, userId);
  await env.DB.prepare("UPDATE learn_profiles SET start_band = ?, band_source = 'CHOSEN', updated_at = ? WHERE user_id = ?")
    .bind(band, nowIso(), userId)
    .run();
}

export async function setDailyGoal(env: Env, userId: string, goalXp: number): Promise<void> {
  await ensureProfile(env, userId);
  await env.DB.prepare('UPDATE learn_profiles SET daily_goal_xp = ?, updated_at = ? WHERE user_id = ?')
    .bind(goalXp, nowIso(), userId)
    .run();
}

/** Everything one award changed, so a caller can report it without re-reading. */
interface AwardOutcome {
  streak: number;
  streakIncreased: boolean;
  goalReached: boolean;
  /** XP after any running boost. */
  xp: number;
  boosted: boolean;
  /** A streak freeze was spent to carry the streak across one missed day. */
  freezeUsed: boolean;
  /** Coins paid by this award (the lesson or review, plus the first-of-the-day bonus). */
  coins: number;
  /** XP on the learner's day after this award. */
  todayXp: number;
}

/**
 * Adds XP to the log and the profile, advances the streak and pays coins.
 *
 * Three rules meet here, and they all have to agree with the client's copy in
 * `shared/shop.ts`:
 *
 *   * a running double-XP item multiplies the award, and the multiplier is
 *     applied to the number the lesson computed — never to the learner's total;
 *   * a streak that would break because exactly one day was missed survives if
 *     the learner holds a freeze, which is spent in the same request (the
 *     conditional decrement is what decides it, so two requests cannot spend
 *     one freeze);
 *   * the first award of a day pays a small login bonus, which is why opening
 *     Learn on a rest day is not wasted.
 */
async function award(
  env: Env,
  userId: string,
  row: ProfileRow,
  xp: number,
  day: string,
  source: string,
  coins: number,
): Promise<AwardOutcome> {
  const before = await xpOnDay(env, userId, day);
  const now = nowIso();
  const boost = applyBoost(xp, row.xp_boost_until);

  const firstToday = row.last_active_day !== day;
  const missedOneDay =
    firstToday && row.last_active_day !== null && dayGap(row.last_active_day, day) === 2;
  let freezeUsed = false;
  if (missedOneDay) {
    const spent = await env.DB.prepare(
      `UPDATE learn_inventory SET quantity = quantity - 1, updated_at = ?
        WHERE user_id = ? AND item_key = 'streak_freeze' AND quantity > 0`,
    )
      .bind(now, userId)
      .run();
    freezeUsed = (spent.meta?.changes ?? 0) > 0;
  }
  const { streak } = streakWithFreeze(
    { streak: row.streak, lastDay: row.last_active_day },
    day,
    freezeUsed ? 1 : 0,
  );

  const lastDay = row.last_active_day && row.last_active_day > day ? row.last_active_day : day;
  const bonus = firstToday ? DAILY_LOGIN_COINS : 0;
  const paid = coins + bonus;

  await env.DB.batch([
    env.DB.prepare('INSERT INTO learn_xp_log (id, user_id, day, xp, source, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      newId('xp'),
      userId,
      day,
      boost.xp,
      source,
      now,
    ),
    env.DB.prepare(
      `UPDATE learn_profiles
          SET xp = xp + ?, streak = ?, best_streak = MAX(best_streak, ?), last_active_day = ?, updated_at = ?
        WHERE user_id = ?`,
    ).bind(boost.xp, streak, streak, lastDay, now, userId),
    ...(paid > 0 ? coinStatements(env, { userId, day, delta: paid, reason: source, now }) : []),
  ]);

  return {
    streak,
    streakIncreased: streak > row.streak,
    goalReached: before < row.daily_goal_xp && before + boost.xp >= row.daily_goal_xp,
    xp: boost.xp,
    boosted: boost.boosted,
    freezeUsed,
    coins: paid,
    todayXp: before + boost.xp,
  };
}

export async function completeLesson(env: Env, userId: string, input: LessonCompletionInput): Promise<LessonCompletionResult> {
  const day = requireDay(input.day);
  // The lesson must exist in the catalogue and be one this learner may play:
  // a personal generated lesson belongs to its owner only.
  const lesson = await getLessonForCompletion(env, userId, input.lessonId);
  if (!lesson) throw ApiError.notFound('That lesson does not exist.');
  const total = Math.floor(input.total);
  const correct = Math.floor(input.correct);
  if (!Number.isFinite(total) || total < 1 || total > MAX_EXERCISES || correct < 0 || correct > total) {
    throw ApiError.validation('That lesson result is not valid.');
  }

  const row = await ensureProfile(env, userId);
  const existing = await env.DB.prepare(
    'SELECT stars, best_accuracy, completions, xp_earned FROM learn_lessons_done WHERE user_id = ? AND lesson_id = ?',
  )
    .bind(userId, lesson.id)
    .first<{ stars: number; best_accuracy: number; completions: number; xp_earned: number }>();

  const xp = lessonXp({ correct, total, completionsBefore: existing?.completions ?? 0 });
  const stars = starsFor(correct, total);
  const accuracy = correct / total;
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO learn_lessons_done (id, user_id, lesson_id, stars, best_accuracy, completions, xp_earned, last_completed_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (user_id, lesson_id) DO UPDATE SET
       stars = MAX(stars, excluded.stars),
       best_accuracy = MAX(best_accuracy, excluded.best_accuracy),
       completions = completions + 1,
       xp_earned = xp_earned + excluded.xp_earned,
       last_completed_at = excluded.last_completed_at`,
  )
    .bind(newId('ld'), userId, lesson.id, stars, accuracy, xp, now)
    .run();

  const coins = coinsForLesson({ correct, total, completionsBefore: existing?.completions ?? 0 });
  const awarded = await award(env, userId, row, xp, day, `lesson:${lesson.id}`, coins);

  // Daily quests are settled here as well as on the overview, so the finish
  // screen can name the quest it just completed instead of the learner finding
  // the coins later with no explanation.
  const counters = await questCounters(env, userId, day, awarded.todayXp, row.daily_goal_xp);
  const settled = await settleQuests(env, userId, day, counters);

  // Missed words go to the notebook so they come back for review. Only words
  // this lesson actually teaches are accepted, so a crafted request cannot use
  // this endpoint to write arbitrary text into the notebook.
  let wordsSaved = 0;
  const missed = [...new Set(input.mistakes.map((term) => term.trim()).filter(Boolean))].slice(0, 12);
  // Only a vocabulary lesson teaches words; the other kinds carry no terms, so
  // there is nothing for a mistake to refer to and nothing is saved.
  const taught = lesson.payload.kind === 'VOCAB' ? lesson.payload.words : [];
  const wordsByTerm = new Map(taught.map((word) => [word.term.toLowerCase(), word]));
  const suggestions: SuggestedWord[] = [];
  for (const term of missed) {
    const word = wordsByTerm.get(term.toLowerCase());
    if (!word) continue;
    suggestions.push({ term: word.term, pos: word.pos, meaning: word.meaning, meaningVi: word.vi, example: word.example, level: lesson.band });
    // A word already in the notebook is brought back sooner.
    await env.DB.prepare(
      'UPDATE vocabulary_entries SET box = MAX(0, box - 1), due_at = NULL, updated_at = ? WHERE user_id = ? AND term = ? COLLATE NOCASE',
    )
      .bind(now, userId, word.term)
      .run();
  }
  if (suggestions.length > 0) wordsSaved = await saveAiVocabulary(env, userId, suggestions, `Lesson: ${lesson.title}`, 'WORDBANK');

  const fresh = await ensureProfile(env, userId);
  return {
    xpGained: awarded.xp,
    boosted: awarded.boosted,
    coinsGained: awarded.coins + settled.coins,
    stars,
    newBest: !existing || stars > existing.stars,
    firstCompletion: !existing,
    wordsSaved,
    streak: awarded.streak,
    streakIncreased: awarded.streakIncreased,
    freezeUsed: awarded.freezeUsed,
    goalReached: awarded.goalReached,
    questsClaimed: settled.claimed,
    profile: await toProfile(env, userId, fresh, day),
    progress: {
      stars: Math.max(stars, existing?.stars ?? 0),
      bestAccuracy: Math.max(accuracy, existing?.best_accuracy ?? 0),
      completions: (existing?.completions ?? 0) + 1,
    },
  };
}

export async function completeReview(env: Env, userId: string, input: ReviewResultInput): Promise<ReviewCompletionResult> {
  const day = requireDay(input.day);
  const results = input.results.slice(0, MAX_EXERCISES);
  let reviewed = 0;
  for (const result of results) {
    try {
      await updateVocabularyEntry(env, userId, result.id, { reviewed: true, correct: result.correct });
      reviewed += 1;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'NOT_FOUND')) throw error;
    }
  }
  if (reviewed === 0) throw ApiError.validation('None of those words are in your notebook.');
  const row = await ensureProfile(env, userId);
  const allRight = results.every((result) => result.correct);
  const xp = reviewed * XP_REVIEW_PER_WORD + (allRight ? 5 : 0);
  const awarded = await award(env, userId, row, xp, day, 'review', coinsForReview(reviewed, allRight));
  const counters = await questCounters(env, userId, day, awarded.todayXp, row.daily_goal_xp);
  const settled = await settleQuests(env, userId, day, counters);
  const fresh = await ensureProfile(env, userId);
  return {
    xpGained: awarded.xp,
    boosted: awarded.boosted,
    coinsGained: awarded.coins + settled.coins,
    reviewed,
    streak: awarded.streak,
    streakIncreased: awarded.streakIncreased,
    goalReached: awarded.goalReached,
    questsClaimed: settled.claimed,
    profile: await toProfile(env, userId, fresh, day),
  };
}

interface NotebookRow {
  id: string;
  term: string;
  pos: string;
  phonetic: string;
  meaning: string;
  meaning_vi: string;
  example: string;
  level: number | null;
}

async function readDailyWords(env: Env, userId: string, limit: number): Promise<DailyWordsResult['words']> {
  const rows = await env.DB.prepare(
    `SELECT id, term, pos, phonetic, meaning, meaning_vi, example, level
       FROM vocabulary_entries WHERE user_id = ? AND source = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  )
    .bind(userId, DAILY_WORDS_SOURCE, limit)
    .all<NotebookRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    term: row.term,
    pos: row.pos,
    phonetic: row.phonetic,
    meaning: row.meaning,
    meaningVi: row.meaning_vi,
    example: row.example,
    level: row.level,
  }));
}

function suggestionFrom(raw: unknown): SuggestedWord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const term = typeof value.term === 'string' ? value.term.trim() : '';
  const meaning = typeof value.meaning === 'string' ? value.meaning.trim() : '';
  if (!term || !meaning) return null;
  const level = typeof value.level === 'number' && Number.isFinite(value.level) ? Math.min(9, Math.max(3, value.level)) : null;
  return {
    term,
    meaning,
    ...(typeof value.pos === 'string' ? { pos: value.pos } : {}),
    ...(typeof value.meaningVi === 'string' ? { meaningVi: value.meaningVi } : {}),
    ...(typeof value.example === 'string' ? { example: value.example } : {}),
    ...(typeof value.ipa === 'string' ? { phonetic: value.ipa } : {}),
    level,
  };
}

/**
 * Today's words: the AI picks them for the learner's band; if it is not
 * available, words from the built-in bank that they do not have yet.
 */
export async function getDailyWords(
  env: Env,
  userId: string,
  options: { day: string; extra?: boolean },
): Promise<DailyWordsResult> {
  const day = requireDay(options.day);
  const row = await ensureProfile(env, userId);
  const placement = await resolveBand(env, userId, row);

  if (!options.extra && row.last_words_day === day) {
    return { added: 0, source: 'NONE', alreadyDone: true, band: placement.band, words: await readDailyWords(env, userId, DAILY_WORD_COUNT) };
  }

  const knownRows = await env.DB.prepare('SELECT term FROM vocabulary_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 150')
    .bind(userId)
    .all<{ term: string }>();
  const known = (knownRows.results ?? []).map((item) => item.term);
  const dayIndex = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

  let added = 0;
  let source: DailyWordsResult['source'] = 'NONE';
  try {
    const { data } = await completeJson<{ words?: unknown[] }>(env, {
      messages: buildVocabMessages({ band: placement.estimate ?? placement.band, count: DAILY_WORD_COUNT, known, dayIndex }),
      temperature: 0.7,
      maxTokens: 1_400,
      timeoutMs: 25_000,
      reasoningEffort: 'low',
    });
    const words = (Array.isArray(data.words) ? data.words : []).map(suggestionFrom).filter((word): word is SuggestedWord => word !== null);
    added = await saveAiVocabulary(env, userId, words.slice(0, DAILY_WORD_COUNT), DAILY_WORDS_SOURCE, 'AI');
    if (added > 0) source = 'AI';
  } catch (error) {
    describeAiFailure(error, { task: 'daily-words' });
  }

  if (added === 0) {
    const have = new Set(known.map((term) => term.toLowerCase()));
    const random = seededRandom(`${userId}:${day}:${options.extra ? 'x' : 'd'}`);
    const candidates = shuffle(
      WORD_BANK.filter((word) => word.band >= placement.band && !have.has(word.term.toLowerCase())),
      random,
    ).slice(0, DAILY_WORD_COUNT);
    added = await saveAiVocabulary(
      env,
      userId,
      candidates.map((word) => ({ term: word.term, pos: word.pos, meaning: word.meaning, meaningVi: word.vi, example: word.example, level: word.band })),
      DAILY_WORDS_SOURCE,
      'WORDBANK',
    );
    if (added > 0) source = 'WORDBANK';
  }

  // Count the day as done even when nothing could be added, so a failing provider is not hammered by every page view.
  await env.DB.prepare('UPDATE learn_profiles SET last_words_day = ?, updated_at = ? WHERE user_id = ?')
    .bind(day, nowIso(), userId)
    .run();

  return { added, source, alreadyDone: false, band: placement.band, words: await readDailyWords(env, userId, Math.max(added, DAILY_WORD_COUNT)) };
}

/** The band a learner is placed on, for callers outside this service. */
export async function getLearnBand(env: Env, userId: string): Promise<LearnBand> {
  const row = await ensureProfile(env, userId);
  const { band } = await resolveBand(env, userId, row);
  return band;
}

/**
 * Wrong options for the review lesson: words from the learner's own band.
 *
 * The exercise engine no longer carries a built-in word bank (that would pull
 * every lesson back into the browser bundle), so the pool has to come from the
 * catalogue like it does for a normal lesson.
 */
export async function getReviewPool(env: Env, userId: string): Promise<LessonWord[]> {
  const row = await ensureProfile(env, userId);
  const { band } = await resolveBand(env, userId, row);
  return wordPool(env, band, '');
}

/** Notebook words that are due, shaped for the review lesson. */
export async function getDueWords(env: Env, userId: string, limit = 8): Promise<DailyWordsResult['words']> {
  const rows = await env.DB.prepare(
    `SELECT id, term, pos, phonetic, meaning, meaning_vi, example, level
       FROM vocabulary_entries
      WHERE user_id = ? AND meaning != '' AND (due_at IS NULL OR due_at <= ?)
      ORDER BY box ASC, COALESCE(due_at, created_at) ASC LIMIT ?`,
  )
    .bind(userId, nowIso(), Math.min(Math.max(limit, 1), 20))
    .all<NotebookRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    term: row.term,
    pos: row.pos,
    phonetic: row.phonetic,
    meaning: row.meaning,
    meaningVi: row.meaning_vi,
    example: row.example,
    level: row.level,
  }));
}
