/**
 * Learn path: the types and pure rules shared by the API and the client.
 *
 * The lessons themselves are static content (`learn-content.ts`) and the
 * exercises are generated from them on the device (`learn-engine.ts`). The
 * server only keeps what has to be trusted: XP, the daily streak, the daily
 * goal and the stars earned in each lesson.
 */
import type { QuestView, ShopItemKey } from './shop';

/**
 * The band ladder: every half band from 4.0 to 8.0.
 *
 * The path used to have four coarse tiers (4/5/6/7). Half bands are what an
 * IELTS candidate actually aims for ("I need 6.5"), and they are fine enough for
 * a study plan to sit on, so the ladder is now nine rungs. Lessons are tagged
 * with the band they are pitched at and the path is grouped by band.
 */
export type LearnBand = 4 | 4.5 | 5 | 5.5 | 6 | 6.5 | 7 | 7.5 | 8;

export const LEARN_BANDS: readonly LearnBand[] = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];

export const LEARN_BAND_LABELS: Record<LearnBand, string> = {
  4: 'First steps',
  4.5: 'Everyday basics',
  5: 'Everyday topics',
  5.5: 'Wider topics',
  6: 'Task language',
  6.5: 'Task range',
  7: 'Academic range',
  7.5: 'Academic precision',
  8: 'Refined academic',
};

export const LEARN_BAND_MIN = 4;
export const LEARN_BAND_MAX = 8;
/** The rung a learner starts on when nothing is known about them. */
export const LEARN_BAND_DEFAULT: LearnBand = 5;

export function isLearnBand(value: number | null | undefined): value is LearnBand {
  return value !== null && value !== undefined && (LEARN_BANDS as readonly number[]).includes(value);
}

/** Position of a band on the ladder, from 0. */
export function bandIndex(band: LearnBand): number {
  return Math.max(0, LEARN_BANDS.indexOf(band));
}

/** The next rung down, or null at the bottom. */
export function bandBelow(band: LearnBand): LearnBand | null {
  const index = bandIndex(band);
  return index > 0 ? LEARN_BANDS[index - 1]! : null;
}

/**
 * Snaps any band estimate onto the ladder: an unknown estimate starts at the
 * middle rung, and anything outside 4.0–8.0 is clamped to the nearest end. A
 * 6.3 estimate sits on 6.5 (round to the nearest half band), never between rungs.
 */
export function bandForEstimate(band: number | null | undefined): LearnBand {
  if (band === null || band === undefined || !Number.isFinite(band)) return LEARN_BAND_DEFAULT;
  if (band <= LEARN_BAND_MIN) return 4;
  if (band >= LEARN_BAND_MAX) return 8;
  const snapped = Math.round(band * 2) / 2;
  return (isLearnBand(snapped) ? snapped : LEARN_BAND_DEFAULT) as LearnBand;
}

/**
 * Where a study plan should pitch NEW material: one rung above the learner's
 * own band, because work at their own band teaches them nothing and two rungs up
 * is out of reach. Capped at the top of the ladder.
 */
export function stretchBand(band: LearnBand): LearnBand {
  const index = Math.min(bandIndex(band) + 1, LEARN_BANDS.length - 1);
  return LEARN_BANDS[index]!;
}

/**
 * Lesson unlocking inside one band.
 *
 * `completed` holds the 0-based positions of the lessons the learner has
 * finished in that band. Everything up to and including one past the furthest
 * finished lesson is open, so a learner can always go back and redo an earlier
 * lesson but cannot skip ahead.
 */
export function openPositionCount(completed: readonly number[], total: number): number {
  if (total <= 0) return 0;
  const inside = completed.filter((position) => Number.isInteger(position) && position >= 0 && position < total);
  if (inside.length === 0) return 1;
  const furthest = Math.max(...inside);
  return Math.min(total, furthest + 2);
}

/**
 * Whether a whole band is open.
 *
 * A band at or below the learner's starting band is always open (they may have
 * been placed above material they still need). Above that, a band opens when the
 * one below it has been finished, so the path stays ordered without locking a
 * learner out of the ladder they were placed on.
 */
export function bandIsOpen(band: LearnBand, startBand: LearnBand, completeBands: readonly LearnBand[]): boolean {
  if (band <= startBand) return true;
  const below = bandBelow(band);
  return below !== null && completeBands.includes(below);
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
  /** The rung of the 4.0–8.0 ladder the learner is placed on. */
  band: LearnBand;
  /** Where the band came from: the learner picked it, it was estimated from their test bands, or the default. */
  bandSource: 'CHOSEN' | 'ESTIMATED' | 'DEFAULT';
  /** The band estimate the placement was derived from, when known. */
  startBand: number | null;
  /** Coins in the wallet (the shop's currency). */
  coins: number;
  /** ISO instant the double-XP window ends, or null when no boost is running. */
  xpBoostUntil: string | null;
  /** Shop items held: quantity per item key; absent keys are zero. */
  inventory: Partial<Record<ShopItemKey, number>>;
}

/**
 * One vocabulary item in a lesson.
 *
 * This lives here rather than with the built-in content because it is the shape
 * the catalogue API sends: lessons are stored in the database, so the client
 * receives them over the wire and must not import the seed content to know the
 * type.
 */
export interface LessonWord {
  term: string;
  pos: string;
  /** Short English definition. */
  meaning: string;
  /** Vietnamese gloss. */
  vi: string;
  /** A sentence that contains `term` exactly as written (a fill-in-the-blank needs it). */
  example: string;
}

/**
 * What a lesson teaches.
 *
 * The path started as vocabulary only. These are the four things a band score
 * actually turns on besides vocabulary, each with a shape that can be marked
 * on the device — no AI call is needed to finish a lesson:
 *
 *   PARAPHRASE  pick the sentence that means the same thing
 *   READING     a short passage with four-option questions and evidence
 *   WRITING     turn a Vietnamese instruction into an English sentence
 *   SPEAKING    answer a question aloud, then compare with a model answer
 */
export const LESSON_KINDS = ['VOCAB', 'PARAPHRASE', 'READING', 'WRITING', 'SPEAKING'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  VOCAB: 'Vocabulary',
  PARAPHRASE: 'Paraphrase',
  READING: 'Reading',
  WRITING: 'Writing',
  SPEAKING: 'Speaking',
};

export function isLessonKind(value: unknown): value is LessonKind {
  return typeof value === 'string' && (LESSON_KINDS as readonly string[]).includes(value);
}

export interface ParaphraseItem {
  /** The sentence to restate. */
  original: string;
  /** The restatement that keeps the meaning. */
  answer: string;
  /** Three sentences that look close but change the meaning. */
  distractors: string[];
  /** Why the answer is right and the others are not. */
  note: string;
}

export interface ReadingQuestion {
  stem: string;
  /** Four options; `answer` is the index of the right one. */
  options: string[];
  answer: number;
  /** The line of the passage the answer comes from. */
  evidence: string;
}

export interface WritingItem {
  /** Vietnamese instruction telling the learner what to say. */
  instruction: string;
  /** The English sentence they are aiming at. */
  model: string;
  /** A short hint: the key word or structure. */
  hint: string;
}

export interface SpeakingItem {
  /** The question an examiner would ask. */
  question: string;
  /** What a good answer has to cover. */
  cue: string;
  /** A model answer to compare with. */
  sample: string;
}

/**
 * A lesson body.
 *
 * Each variant carries its own `kind` tag, so the union discriminates and a
 * `switch` over it is checked exhaustively. The kind is also a column beside
 * `payload_json`, which is what lets the catalogue filter and count by kind
 * without parsing a row; the copy inside the body is what lets a payload be
 * validated on its own.
 */
export interface VocabPayload {
  kind: 'VOCAB';
  words: LessonWord[];
}
export interface ParaphrasePayload {
  kind: 'PARAPHRASE';
  items: ParaphraseItem[];
}
export interface ReadingPayload {
  kind: 'READING';
  passage: string;
  questions: ReadingQuestion[];
}
export interface WritingPayload {
  kind: 'WRITING';
  /** An original, complete IELTS-style task prompt shown before the sentence drills. */
  taskPrompt?: string;
  taskType?: 'TASK_1' | 'TASK_2';
  items: WritingItem[];
}
export interface SpeakingPayload {
  kind: 'SPEAKING';
  items: SpeakingItem[];
}

export type LessonPayload = VocabPayload | ParaphrasePayload | ReadingPayload | WritingPayload | SpeakingPayload;

/** A lesson without its body: enough to draw the path. */
export interface CatalogueLessonRef {
  id: string;
  title: string;
  blurb: string;
  /** Position inside the band, from 0. Unlocking follows this order. */
  position: number;
  unitKey: string;
  unitTitle: string;
  kind: LessonKind;
  /** How many items the lesson holds (words, questions, prompts), so the path can say so without sending them. */
  itemCount: number;
  /** A one-line taste of the lesson for the popup on the path. */
  preview: string;
  /** Where the lesson came from. Never names an AI model, only whether it was built in or generated. */
  origin: 'BUILT_IN' | 'ADMIN_AI' | 'PERSONAL_AI';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  /** A harder, upgraded variant unlocked by reaching this band in practice. */
  legendary: boolean;
  /** Optional teaching video (YouTube or any embeddable URL) set by an admin. */
  videoUrl?: string;
}

/** What the band selector needs: one row per rung. */
export interface CatalogueBandSummary {
  band: LearnBand;
  label: string;
  lessonCount: number;
  /** Lessons this learner has finished at that band. */
  completedCount: number;
}

export interface CatalogueUnit {
  unitKey: string;
  title: string;
  blurb: string;
  lessons: CatalogueLessonRef[];
}

export interface CatalogueResponse {
  bands: CatalogueBandSummary[];
  /** Full lesson bodies for the requested band only, so the payload stays small. */
  selected: { band: LearnBand; label: string; units: CatalogueUnit[] };
}

/** Everything the player needs to build one lesson's exercises. */
export interface LessonPlayPayload {
  id: string;
  band: LearnBand;
  kind: LessonKind;
  unitTitle: string;
  title: string;
  blurb: string;
  payload: LessonPayload;
  /** Other words at the same band, used as the wrong options in a vocabulary lesson. */
  pool: LessonWord[];
  /** A harder, upgraded variant: the in-lesson dictionary lookup is off here. */
  legendary: boolean;
  /** Optional teaching video shown above the exercises. */
  videoUrl?: string;
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
  /** Today's quests with their progress, and whether their coins were paid. */
  quests: QuestView[];
  /** Coins paid by quests settled during this request (normally zero). */
  coinsFromQuests: number;
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
  /** True when a double-XP item was running and the award was doubled. */
  boosted: boolean;
  /** Coins paid by this lesson. */
  coinsGained: number;
  stars: number;
  newBest: boolean;
  firstCompletion: boolean;
  /** Words saved to the notebook because they were missed. */
  wordsSaved: number;
  streak: number;
  streakIncreased: boolean;
  /** True when a streak freeze was spent to keep the streak across a missed day. */
  freezeUsed: boolean;
  goalReached: boolean;
  /** Quests that completed with this lesson and paid their coins now. */
  questsClaimed: QuestView[];
  profile: LearnProfile;
  progress: LearnProgressItem;
}

export interface ReviewResultInput {
  results: Array<{ id: string; correct: boolean }>;
  day: string;
}

/** What the review player shows on its finish screen. */
export interface ReviewCompletionResult {
  xpGained: number;
  boosted: boolean;
  coinsGained: number;
  reviewed: number;
  streak: number;
  streakIncreased: boolean;
  goalReached: boolean;
  questsClaimed: QuestView[];
  profile: LearnProfile;
}

/**
 * A Vietnamese rendering of one English sentence, for the answer panel.
 *
 * `source` is `CACHE` when the sentence had been translated before (which is
 * how the built-in lessons become instant after the first learner sees them),
 * `AI` on the first translation, and `NONE` when no provider answered —
 * in which case the client falls back to the word's own Vietnamese gloss
 * rather than showing nothing.
 */
export interface TranslationResult {
  vi: string;
  source: 'CACHE' | 'AI' | 'NONE';
  available: boolean;
}

export interface DailyWordsResult {
  /** True when new words were added by this request. */
  added: number;
  source: 'AI' | 'WORDBANK' | 'NONE';
  alreadyDone: boolean;
  /** The band the words were pitched to. */
  band: LearnBand;
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

// ----------------------------------------------------------------- study plan
/** A dated step in a study plan. */
export type PlanItemKind = 'LESSON' | 'REVIEW' | 'MOCK_TEST';
export type PlanItemStatus = 'PENDING' | 'DONE' | 'SKIPPED';
export type PlanSkillName = 'READING' | 'LISTENING' | 'WRITING' | 'OVERALL';

export interface PlanItemView {
  id: string;
  day: string;
  slot: number;
  kind: PlanItemKind;
  lessonId: string | null;
  /** Null when the lesson was archived after the plan was built; the label still says what the day was for. */
  lessonTitle: string | null;
  label: string;
  band: LearnBand | null;
  skill: PlanSkillName | null;
  status: PlanItemStatus;
}

export interface PlanView {
  id: string;
  targetBand: LearnBand;
  examDay: string | null;
  minutesPerDay: number;
  /** The band the plan was built from. */
  currentBand: LearnBand;
  startDay: string;
  daysCovered: number;
  createdAt: string;
  /** The most recent estimated band per skill, for the header. */
  skillBands: Partial<Record<PlanSkillName, number>>;
  stats: { total: number; done: number; lessons: number; mocks: number };
  days: Array<{ day: string; items: PlanItemView[] }>;
  /** Today's steps, so the page can put them first without the client re-deriving them. */
  today: PlanItemView[];
}

export interface PlanRequest {
  targetBand: LearnBand;
  /** `YYYY-MM-DD`, or null when no exam is booked. */
  examDay: string | null;
  minutesPerDay: number;
}
