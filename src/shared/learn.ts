/**
 * Learn path: the types and pure rules shared by the API and the client.
 *
 * The lessons themselves are static content (`learn-content.ts`) and the
 * exercises are generated from them on the device (`learn-engine.ts`). The
 * server only keeps what has to be trusted: XP, the daily streak, the daily
 * goal and the stars earned in each lesson.
 */

/** Four difficulty tiers, from "Foundations" (about band 4) to "Academic" (band 7+). */
export type LearnLevel = 4 | 5 | 6 | 7;

export const LEARN_LEVELS: readonly LearnLevel[] = [4, 5, 6, 7];

export const LEARN_LEVEL_LABELS: Record<LearnLevel, string> = {
  4: 'Foundations',
  5: 'Everyday topics',
  6: 'Task language',
  7: 'Academic range',
};

/** Maps an estimated overall band to the tier a learner should start in. Unknown means the middle tier. */
export function levelForBand(band: number | null | undefined): LearnLevel {
  if (band === null || band === undefined || !Number.isFinite(band)) return 5;
  if (band < 4.5) return 4;
  if (band < 6) return 5;
  if (band < 7) return 6;
  return 7;
}

/** XP: 10 for finishing, +1 per exercise answered right first time, +5 for a perfect lesson. Repeats pay half. */
export const XP_BASE = 10;
export const XP_PERFECT_BONUS = 5;
export const XP_REVIEW_PER_WORD = 2;

export function lessonXp(input: { correct: number; total: number; completionsBefore: number }): number {
  const total = Math.max(0, Math.floor(input.total));
  const correct = Math.min(total, Math.max(0, Math.floor(input.correct)));
  const perfect = total > 0 && correct === total;
  const raw = XP_BASE + correct + (perfect ? XP_PERFECT_BONUS : 0);
  return input.completionsBefore > 0 ? Math.max(1, Math.round(raw / 2)) : raw;
}

/** One star for finishing, two for 70% first-time accuracy, three for 90%. */
export function starsFor(correct: number, total: number): 1 | 2 | 3 {
  const accuracy = total > 0 ? correct / total : 0;
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.7) return 2;
  return 1;
}

/** A calendar day as `YYYY-MM-DD`, in whatever zone the date is formatted for. */
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function utcDay(date: Date | number): string {
  return new Date(date).toISOString().slice(0, 10);
}

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/**
 * The client sends the candidate's local day so the streak follows their
 * midnight, not UTC. Time zones span UTC-12 to UTC+14, so a legitimate local
 * day is never more than one day away from the server's UTC day.
 */
export function isPlausibleDay(day: string, nowMs: number = Date.now()): boolean {
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return false;
  return Math.abs(dayNumber(day) - dayNumber(utcDay(nowMs))) <= 1;
}

/** The streak after activity on `today`, given the previous streak and the last active day. */
export function nextStreak(previous: { streak: number; lastDay: string | null }, today: string): number {
  if (!previous.lastDay) return 1;
  const gap = dayNumber(today) - dayNumber(previous.lastDay);
  if (gap <= 0) return Math.max(1, previous.streak);
  if (gap === 1) return previous.streak + 1;
  return 1;
}

/** True when the streak is still alive today (active today or yesterday). */
export function streakAlive(lastDay: string | null, today: string): boolean {
  if (!lastDay) return false;
  return dayNumber(today) - dayNumber(lastDay) <= 1;
}

export interface LearnProgressItem {
  stars: number;
  bestAccuracy: number;
  completions: number;
}

export interface LearnProfile {
  xp: number;
  streak: number;
  bestStreak: number;
  dailyGoalXp: number;
  /** XP earned on the candidate's current day. */
  todayXp: number;
  lastActiveDay: string | null;
  level: LearnLevel;
  /** Where the level came from: the learner picked it, it was estimated from their bands, or the default. */
  levelSource: 'CHOSEN' | 'ESTIMATED' | 'DEFAULT';
  /** The band the level was derived from, when known. */
  startBand: number | null;
}

export interface LearnOverview {
  profile: LearnProfile;
  progress: Record<string, LearnProgressItem>;
  /** Notebook words due for review today. */
  dueWords: number;
  /** Whether today's AI words were already added. */
  dailyWordsDone: boolean;
  /** Last 7 days of XP, oldest first, keyed by day. */
  week: Array<{ day: string; xp: number }>;
}

export interface LessonCompletionInput {
  lessonId: string;
  /** Exercises answered right on the first try. */
  correct: number;
  total: number;
  /** Terms of the words that were missed, so they go to the notebook for review. */
  mistakes: string[];
  /** The learner's local calendar day. */
  day: string;
}

export interface LessonCompletionResult {
  xpGained: number;
  stars: number;
  newBest: boolean;
  firstCompletion: boolean;
  /** Words saved to the notebook because they were missed. */
  wordsSaved: number;
  streak: number;
  streakIncreased: boolean;
  goalReached: boolean;
  profile: LearnProfile;
  progress: LearnProgressItem;
}

export interface ReviewResultInput {
  results: Array<{ id: string; correct: boolean }>;
  day: string;
}

export interface DailyWordsResult {
  /** True when new words were added by this request. */
  added: number;
  source: 'AI' | 'WORDBANK' | 'NONE';
  alreadyDone: boolean;
  level: LearnLevel;
  words: Array<{
    id: string;
    term: string;
    pos: string;
    phonetic: string;
    meaning: string;
    meaningVi: string;
    example: string;
    level: number | null;
  }>;
}

/** Everything the dictionary knows about one word. */
export interface DictionaryMeaning {
  pos: string;
  definitions: Array<{ en: string; vi: string; example: string }>;
  synonyms: string[];
}

export interface DictionaryEntry {
  term: string;
  phonetic: string;
  /** CEFR-style level when known (B1, B2, C1 …). */
  level: string;
  meanings: DictionaryMeaning[];
  /** Where the entry came from. The AI is never named. */
  source: 'WORDBANK' | 'CACHE' | 'ONLINE' | 'AI';
  /** True when this word is already in the learner's notebook. */
  saved?: boolean;
}
