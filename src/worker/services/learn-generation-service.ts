import type { Env } from '../env';
import { ApiError, type ErrorCode } from '../lib/errors';
import { parseJson } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { AI_NOT_CONFIGURED_MESSAGE } from '../ai/judges';
import { buildLessonGenerationMessages, buildPersonalLessonMessages } from '../ai/learn-prompts';
import { lessonItemCount, normaliseLessonPayload } from '../../shared/lesson-payload';
import {
  type LearnBand,
  type LessonKind,
  type LessonPayload,
} from '../../shared/learn';
import { ensureCatalogue, insertLesson } from './learn-catalogue-service';

/**
 * A provider failure, worded for someone waiting on a lesson.
 *
 * `describeAiFailure` is shared with marking, so its copy talks about judges and
 * about a teacher marking the work later — none of which is true here. The
 * underlying diagnosis is kept; only the wording is replaced, and a genuine
 * storage problem is passed through untouched because its text is already right.
 */
function lessonFailure(error: unknown, task: 'lesson-generate' | 'personal-lesson'): ApiError {
  const described = describeAiFailure(error, { task });
  if (described.code === 'RATE_LIMITED') {
    return new ApiError(described.code, 'That is a lot of generated lessons in a short time. Try again in a minute.');
  }
  if (described.code === 'AI_UNAVAILABLE') {
    const message =
      described.message === AI_NOT_CONFIGURED_MESSAGE
        ? 'No AI provider is switched on, so lessons cannot be generated yet. An administrator can add one under Settings.'
        : 'The provider could not finish that lesson. Nothing was saved; try again in a moment.';
    return new ApiError(described.code, message);
  }
  return new ApiError(described.code as ErrorCode, described.message);
}

/**
 * Generating lessons with the configured AI provider.
 *
 * Two very different jobs live here:
 *
 *   `generateLessons` fills a band. An administrator asks for lessons at a band
 *   and of a kind; the result is stored as a DRAFT, so nothing an AI wrote
 *   reaches a learner until a person has read it. That is deliberate: this is
 *   teaching material, and a wrong answer key is worse than a missing lesson.
 *
 *   `buildPersonalLesson` fills one learner's weak spots. It is published
 *   straight away because it is private to them, built only from words already
 *   in their own notebook, and it revises rather than tests.
 *
 * Both go through `normaliseLessonPayload`, so a malformed batch costs a failed
 * request and never a broken lesson.
 */

/** Vocab is compact enough to batch; 30-question lesson types are generated one at a time. */
const MAX_LESSONS_PER_CALL: Record<LessonKind, number> = {
  VOCAB: 6,
  PARAPHRASE: 1,
  READING: 1,
  WRITING: 1,
  SPEAKING: 1,
};
/** Content items per generated lesson; six vocabulary words expand to about thirty exercises in the player. */
const ITEMS_PER_LESSON: Record<LessonKind, number> = {
  VOCAB: 6,
  PARAPHRASE: 30,
  READING: 30,
  WRITING: 30,
  SPEAKING: 30,
};

export interface GenerateLessonsInput {
  /** Tag the batch as legendary: a harder set unlocked by reaching the band in practice. */
  legendary?: boolean;
  band: LearnBand;
  kind: LessonKind;
  count: number;
  unitKey: string;
  unitTitle: string;
  unitBlurb?: string;
  /** 'DRAFT' keeps them out of the path until an administrator publishes them. */
  publish?: boolean;
  actorUserId: string | null;
}

export interface GenerateLessonsResult {
  created: number;
  titles: string[];
  /** One line per lesson that could not be used, so a partial batch is explainable. */
  rejected: string[];
}

/** Titles and vocabulary already at a band, so a batch does not repeat itself. */
async function existingAtBand(
  env: Env,
  band: LearnBand,
): Promise<{ titles: string[]; terms: string[] }> {
  const rows = await env.DB
    .prepare("SELECT title, payload_json FROM learn_lessons WHERE band = ? AND owner_id IS NULL AND status != 'ARCHIVED'")
    .bind(band)
    .all<{ title: string; payload_json: string }>();

  const titles: string[] = [];
  const terms: string[] = [];
  for (const row of rows.results ?? []) {
    titles.push(row.title);
    const body = parseJson<{ words?: Array<{ term?: string }> }>(row.payload_json, {});
    for (const word of body.words ?? []) if (typeof word.term === 'string') terms.push(word.term);
  }
  return { titles, terms };
}

/** Turns one raw generated lesson into a payload of the requested kind. */
function payloadFromRaw(kind: LessonKind, raw: Record<string, unknown>): LessonPayload | null {
  const payload = (() => {
    switch (kind) {
      case 'VOCAB':
        return normaliseLessonPayload(kind, { words: raw.words });
      case 'PARAPHRASE':
      case 'SPEAKING':
        return normaliseLessonPayload(kind, { items: raw.items });
      case 'WRITING':
        return normaliseLessonPayload(kind, { taskPrompt: raw.taskPrompt, taskType: raw.taskType, items: raw.items });
      case 'READING':
        return normaliseLessonPayload(kind, { passage: raw.passage, questions: raw.questions });
      default:
        return null;
    }
  })();
  if (!payload) return null;
  if (kind === 'VOCAB') return payload.kind === 'VOCAB' && payload.words.length >= 6 ? payload : null;
  if (lessonItemCount(payload) < ITEMS_PER_LESSON[kind]) return null;
  if (kind === 'WRITING' && (payload.kind !== 'WRITING' || !payload.taskPrompt || !payload.taskType)) return null;
  return payload;
}

export async function generateLessons(env: Env, input: GenerateLessonsInput): Promise<GenerateLessonsResult> {
  await ensureCatalogue(env);
  const count = Math.min(MAX_LESSONS_PER_CALL[input.kind], Math.max(1, Math.floor(input.count)));
  const avoid = await existingAtBand(env, input.band);

  let data: { lessons?: unknown[] };
  try {
    const result = await completeJson<{ lessons?: unknown[] }>(env, {
      messages: buildLessonGenerationMessages({
        kind: input.kind,
        band: input.band,
        count,
        items: ITEMS_PER_LESSON[input.kind],
        unitTitle: input.unitTitle,
        avoidTitles: avoid.titles,
        avoidTerms: avoid.terms,
      }),
      temperature: 0.8,
      maxTokens: input.kind === 'VOCAB' ? 8_000 : 20_000,
      timeoutMs: 90_000,
      reasoningEffort: 'medium',
    });
    data = result.data ?? {};
  } catch (error) {
    throw lessonFailure(error, 'lesson-generate');
  }

  const created: string[] = [];
  const rejected: string[] = [];
  const raws = Array.isArray(data.lessons) ? data.lessons : [];
  if (raws.length === 0) throw new ApiError('AI_UNAVAILABLE', 'The provider returned no lessons.');

  for (const entry of raws.slice(0, count)) {
    if (!entry || typeof entry !== 'object') {
      rejected.push('An entry was not an object.');
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
    const payload = payloadFromRaw(input.kind, raw);
    if (!title || !payload) {
      rejected.push(title ? `“${title}” had no usable content.` : 'An entry had no title.');
      continue;
    }
    if (avoid.titles.some((existing) => existing.toLowerCase() === title.toLowerCase())) {
      rejected.push(`“${title}” already exists at this band.`);
      continue;
    }
    avoid.titles.push(title);
    await insertLesson(env, {
      band: input.band,
      kind: input.kind,
      unitKey: input.unitKey,
      unitTitle: input.unitTitle,
      unitBlurb: input.unitBlurb,
      title,
      blurb: typeof raw.blurb === 'string' ? raw.blurb.trim().slice(0, 240) : '',
      payload,
      status: input.publish ? 'PUBLISHED' : 'DRAFT',
      origin: 'ADMIN_AI',
      legendary: input.legendary,
      createdBy: input.actorUserId,
    });
    created.push(title);
  }

  await recordAudit(env, {
    actorUserId: input.actorUserId,
    action: 'LEARN_LESSON_GENERATE',
    entityType: 'learn_lesson',
    metadata: { band: input.band, kind: input.kind, created: created.length, rejected: rejected.length },
  });

  if (created.length === 0) throw new ApiError('AI_UNAVAILABLE', 'None of the generated lessons could be used.');
  return { created: created.length, titles: created, rejected };
}

interface NotebookWord {
  term: string;
  meaning: string;
  meaning_vi: string;
  example: string;
}

/**
 * A private revision lesson built from the words this learner keeps missing.
 *
 * The words come from their notebook, weakest Leitner box first — that is where
 * `completeLesson` puts a word they got wrong, so the box order is a record of
 * what they actually struggle with.
 */
export async function buildPersonalLesson(
  env: Env,
  userId: string,
  band: LearnBand,
): Promise<{ lessonId: string; title: string }> {
  await ensureCatalogue(env);

  const rows = await env.DB.prepare(
    `SELECT term, meaning, meaning_vi, example FROM vocabulary_entries
      WHERE user_id = ? AND meaning != ''
      ORDER BY box ASC, COALESCE(due_at, created_at) ASC LIMIT 8`,
  )
    .bind(userId)
    .all<NotebookWord>();
  const missed = (rows.results ?? []).filter((row) => row.term.trim());
  if (missed.length < 3) {
    throw ApiError.validation('Finish a few lessons first: a revision lesson is built from the words you missed.');
  }

  let data: { lesson?: unknown };
  try {
    const result = await completeJson<{ lesson?: unknown }>(env, {
      messages: buildPersonalLessonMessages({
        band,
        missed: missed.map((row) => ({
          term: row.term,
          meaning: row.meaning,
          meaningVi: row.meaning_vi,
          example: row.example,
        })),
      }),
      temperature: 0.7,
      maxTokens: 2_000,
      timeoutMs: 40_000,
      reasoningEffort: 'low',
    });
    data = result.data ?? {};
  } catch (error) {
    throw lessonFailure(error, 'personal-lesson');
  }

  const raw = data.lesson && typeof data.lesson === 'object' ? (data.lesson as Record<string, unknown>) : null;
  const payload = raw ? normaliseLessonPayload('WRITING', { items: raw.items }) : null;
  const title = raw && typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : 'Your revision lesson';
  if (!payload) throw new ApiError('AI_UNAVAILABLE', 'The revision lesson could not be built. Try again in a moment.');

  const lessonId = await insertLesson(env, {
    band,
    kind: 'WRITING',
    unitKey: 'personal',
    unitTitle: 'Your revision',
    unitBlurb: 'Built from the words you missed.',
    title,
    blurb: `Revises ${Math.min(missed.length, 8)} words from your notebook.`,
    payload,
    status: 'PUBLISHED',
    origin: 'PERSONAL_AI',
    ownerId: userId,
    createdBy: userId,
  });
  return { lessonId, title };
}

/** The learner's most recent personal lesson, with the day it was made. */
export async function latestPersonalLesson(
  env: Env,
  userId: string,
): Promise<{ lessonId: string; title: string; createdAt: string } | null> {
  const row = await env.DB.prepare(
    `SELECT id, title, created_at FROM learn_lessons
      WHERE owner_id = ? AND origin = 'PERSONAL_AI' AND status = 'PUBLISHED'
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string; title: string; created_at: string }>();
  return row ? { lessonId: row.id, title: row.title, createdAt: row.created_at } : null;
}
