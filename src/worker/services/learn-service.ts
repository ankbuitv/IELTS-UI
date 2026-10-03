import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { buildVocabMessages } from '../ai/coach-prompts';
import { levelHintForUser } from './ai-marking-service';
import { saveAiVocabulary, updateVocabularyEntry, type SuggestedWord } from './vocabulary-service';
import { WORD_BANK, findBankWord, lessonById } from '../../shared/learn-content';
import { seededRandom, shuffle } from '../../shared/learn-engine';
import {
  XP_REVIEW_PER_WORD,
  isPlausibleDay,
  lessonXp,
  levelForBand,
  nextStreak,
  starsFor,
  type DailyWordsResult,
  type LearnLevel,
  type LearnOverview,
  type LearnProfile,
  type LearnProgressItem,
  type LessonCompletionInput,
  type LessonCompletionResult,
  type ReviewResultInput,
} from '../../shared/learn';

/**
 * Learn path service.
 *
 * What is trusted lives here: XP, the streak, the daily goal and lesson stars.
 * The lesson content and exercises are generated on the device, so the server
 * only validates the lesson id and the plausibility of what the client reports
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
  last_words_day: string | null;
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
    `SELECT user_id, xp, streak, best_streak, last_active_day, daily_goal_xp, start_band, last_words_day
       FROM learn_profiles WHERE user_id = ?`,
  )
    .bind(userId)
    .first<ProfileRow>();
  if (!row) throw new ApiError('INTERNAL', 'Your learning profile could not be created.');
  return row;
}

async function resolveLevel(
  env: Env,
  userId: string,
  row: ProfileRow,
): Promise<{ level: LearnLevel; source: LearnProfile['levelSource']; band: number | null }> {
  if (row.start_band !== null) return { level: levelForBand(row.start_band), source: 'CHOSEN', band: row.start_band };
  const estimate = await levelHintForUser(env, userId).catch(() => null);
  if (estimate !== null) return { level: levelForBand(estimate), source: 'ESTIMATED', band: estimate };
  return { level: 5, source: 'DEFAULT', band: null };
}

async function xpOnDay(env: Env, userId: string, day: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(xp), 0) AS total FROM learn_xp_log WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function toProfile(env: Env, userId: string, row: ProfileRow, day: string): Promise<LearnProfile> {
  const level = await resolveLevel(env, userId, row);
  return {
    xp: row.xp,
    streak: row.streak,
    bestStreak: row.best_streak,
    dailyGoalXp: row.daily_goal_xp,
    todayXp: await xpOnDay(env, userId, day),
    lastActiveDay: row.last_active_day,
    level: level.level,
    levelSource: level.source,
    startBand: level.band,
  };
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

  return { profile, progress, dueWords: due?.due ?? 0, dailyWordsDone: row.last_words_day === day, week };
}

export async function setLearnLevel(env: Env, userId: string, level: LearnLevel): Promise<void> {
  await ensureProfile(env, userId);
  await env.DB.prepare('UPDATE learn_profiles SET start_band = ?, updated_at = ? WHERE user_id = ?')
    .bind(level, nowIso(), userId)
    .run();
}

export async function setDailyGoal(env: Env, userId: string, goalXp: number): Promise<void> {
  await ensureProfile(env, userId);
  await env.DB.prepare('UPDATE learn_profiles SET daily_goal_xp = ?, updated_at = ? WHERE user_id = ?')
    .bind(goalXp, nowIso(), userId)
    .run();
}

/** Adds XP to the log and the profile, and advances the streak. */
async function award(
  env: Env,
  userId: string,
  row: ProfileRow,
  xp: number,
  day: string,
  source: string,
): Promise<{ streak: number; streakIncreased: boolean; goalReached: boolean }> {
  const before = await xpOnDay(env, userId, day);
  const streak = nextStreak({ streak: row.streak, lastDay: row.last_active_day }, day);
  const lastDay = row.last_active_day && row.last_active_day > day ? row.last_active_day : day;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO learn_xp_log (id, user_id, day, xp, source, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      newId('xp'),
      userId,
      day,
      xp,
      source,
      now,
    ),
    env.DB.prepare(
      `UPDATE learn_profiles
          SET xp = xp + ?, streak = ?, best_streak = MAX(best_streak, ?), last_active_day = ?, updated_at = ?
        WHERE user_id = ?`,
    ).bind(xp, streak, streak, lastDay, now, userId),
  ]);
  return {
    streak,
    streakIncreased: streak > row.streak,
    goalReached: before < row.daily_goal_xp && before + xp >= row.daily_goal_xp,
  };
}

export async function completeLesson(env: Env, userId: string, input: LessonCompletionInput): Promise<LessonCompletionResult> {
  const day = requireDay(input.day);
  const lesson = lessonById(input.lessonId);
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

  const awarded = await award(env, userId, row, xp, day, `lesson:${lesson.id}`);

  // Missed words go to the notebook so they come back for review.
  let wordsSaved = 0;
  const missed = [...new Set(input.mistakes.map((term) => term.trim()).filter(Boolean))].slice(0, 12);
  const suggestions: SuggestedWord[] = [];
  for (const term of missed) {
    const word = findBankWord(term);
    if (!word) continue;
    suggestions.push({ term: word.term, pos: word.pos, meaning: word.meaning, meaningVi: word.vi, example: word.example, level: word.level });
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
    xpGained: xp,
    stars,
    newBest: !existing || stars > existing.stars,
    firstCompletion: !existing,
    wordsSaved,
    streak: awarded.streak,
    streakIncreased: awarded.streakIncreased,
    goalReached: awarded.goalReached,
    profile: await toProfile(env, userId, fresh, day),
    progress: {
      stars: Math.max(stars, existing?.stars ?? 0),
      bestAccuracy: Math.max(accuracy, existing?.best_accuracy ?? 0),
      completions: (existing?.completions ?? 0) + 1,
    },
  };
}

export async function completeReview(
  env: Env,
  userId: string,
  input: ReviewResultInput,
): Promise<{ xpGained: number; reviewed: number; profile: LearnProfile; streak: number; streakIncreased: boolean; goalReached: boolean }> {
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
  const awarded = await award(env, userId, row, xp, day, 'review');
  const fresh = await ensureProfile(env, userId);
  return { xpGained: xp, reviewed, profile: await toProfile(env, userId, fresh, day), ...awarded };
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
 * Today's words: the AI picks them for the learner's level; if it is not
 * available, words from the built-in bank that they do not have yet.
 */
export async function getDailyWords(
  env: Env,
  userId: string,
  options: { day: string; extra?: boolean },
): Promise<DailyWordsResult> {
  const day = requireDay(options.day);
  const row = await ensureProfile(env, userId);
  const level = await resolveLevel(env, userId, row);

  if (!options.extra && row.last_words_day === day) {
    return { added: 0, source: 'NONE', alreadyDone: true, level: level.level, words: await readDailyWords(env, userId, DAILY_WORD_COUNT) };
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
      messages: buildVocabMessages({ band: level.band ?? level.level, count: DAILY_WORD_COUNT, known, dayIndex }),
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
      WORD_BANK.filter((word) => word.level >= level.level && !have.has(word.term.toLowerCase())),
      random,
    ).slice(0, DAILY_WORD_COUNT);
    added = await saveAiVocabulary(
      env,
      userId,
      candidates.map((word) => ({ term: word.term, pos: word.pos, meaning: word.meaning, meaningVi: word.vi, example: word.example, level: word.level })),
      DAILY_WORDS_SOURCE,
      'WORDBANK',
    );
    if (added > 0) source = 'WORDBANK';
  }

  // Count the day as done even when nothing could be added, so a failing provider is not hammered by every page view.
  await env.DB.prepare('UPDATE learn_profiles SET last_words_day = ?, updated_at = ? WHERE user_id = ?')
    .bind(day, nowIso(), userId)
    .run();

  return { added, source, alreadyDone: false, level: level.level, words: await readDailyWords(env, userId, Math.max(added, DAILY_WORD_COUNT)) };
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
