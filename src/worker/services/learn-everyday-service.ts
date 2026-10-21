import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { nowIso, parseJson } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { VOCAB_TOPICS } from '../ai/coach-prompts';
import { buildEverydayLessonMessages } from '../ai/learn-prompts';
import { EVERYDAY_QUOTES, isLessonKind, type EverydayLessonView, type EverydayLessonsResponse, type LearnBand, type LessonKind, type LessonPayload } from '../../shared/learn';
import { seededRandom, shuffle } from '../../shared/learn-engine';
import { WORD_BANK } from '../../shared/learn-content';
import { lessonItemCount, normaliseLessonPayload } from '../../shared/lesson-payload';
import { insertLesson, ensureCatalogue } from './learn-catalogue-service';

const DAILY_KINDS: LessonKind[] = ['VOCAB', 'VOCAB', 'PARAPHRASE', 'READING', 'WRITING', 'SPEAKING'];
const DAILY_LESSON_COUNT = 6;

interface RawEverydayLesson {
  title?: unknown;
  blurb?: unknown;
  kind?: unknown;
  payload?: unknown;
}

interface DailyLessonRow {
  slot: number;
  quote: string;
  id: string;
  title: string;
  blurb: string;
  kind: string;
  payload_json: string;
  completions: number;
}

function quoteFor(day: string, slot: number): string {
  const epochDay = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const index = ((epochDay + slot) % EVERYDAY_QUOTES.length + EVERYDAY_QUOTES.length) % EVERYDAY_QUOTES.length;
  return EVERYDAY_QUOTES[index]!;
}

function questionCount(kind: LessonKind, payload: LessonPayload): number {
  // Vocabulary uses five different recall modes for each of its six source
  // words, making it a complete 30-question practice set.
  return kind === 'VOCAB' ? 30 : lessonItemCount(payload);
}

async function readSet(env: Env, userId: string, band: LearnBand, day: string): Promise<EverydayLessonsResponse | null> {
  const result = await env.DB.prepare(
    `SELECT d.slot, d.quote, l.id, l.title, l.blurb, l.kind, l.payload_json,
            COALESCE(done.completions, 0) AS completions
       FROM learn_daily_lessons d
       JOIN learn_lessons l ON l.id = d.lesson_id
  LEFT JOIN learn_lessons_done done ON done.user_id = d.user_id AND done.lesson_id = l.id
      WHERE d.user_id = ? AND d.day = ? AND d.band = ?
   ORDER BY d.slot`,
  )
    .bind(userId, day, band)
    .all<DailyLessonRow>();
  const rows = result.results ?? [];
  if (rows.length !== DAILY_LESSON_COUNT) return null;

  let previousCompleted = true;
  const lessons: EverydayLessonView[] = rows.map((row) => {
    const kind = isLessonKind(row.kind) ? row.kind : 'VOCAB';
    const payload = normaliseLessonPayload(kind, parseJson<unknown>(row.payload_json, null));
    const completed = row.completions > 0;
    const unlocked = previousCompleted;
    previousCompleted = completed;
    return {
      id: row.id,
      band,
      slot: row.slot,
      title: row.title,
      blurb: row.blurb,
      kind,
      questionCount: payload ? questionCount(kind, payload) : 0,
      quote: row.quote,
      completed,
      unlocked,
    };
  });

  return { day, band, lessons };
}

/**
 * Offline stand-in used whenever the AI cannot produce today's set: six VOCAB
 * lessons built from the shipped word bank, chosen by a seeded draw so the day
 * is stable for the learner. Everyday Lessons must never simply "not appear".
 */
async function generateOfflineSet(env: Env, userId: string, band: LearnBand, day: string): Promise<void> {
  const random = seededRandom(`${userId}:${day}:${band}:everyday-offline`);
  const pool = shuffle(
    WORD_BANK.filter((word) => word.band === band).length >= 36
      ? WORD_BANK.filter((word) => word.band === band)
      : WORD_BANK,
    random,
  );
  const topics = shuffle(VOCAB_TOPICS, random);
  const now = nowIso();
  const created: Array<{ lessonId: string; slot: number; quote: string }> = [];
  for (let slot = 0; slot < DAILY_LESSON_COUNT; slot += 1) {
    const words = pool.slice(slot * 6, slot * 6 + 6).map((word) => ({
      term: word.term,
      pos: word.pos,
      meaning: word.meaning,
      vi: word.vi,
      example: word.example,
    }));
    while (words.length < 6) {
      const extra = pool[words.length % Math.max(1, pool.length)];
      if (!extra) break;
      words.push({ term: extra.term, pos: extra.pos, meaning: extra.meaning, vi: extra.vi, example: extra.example });
    }
    const payload = normaliseLessonPayload('VOCAB', { words });
    if (!payload) continue;
    const topic = topics[slot] ?? 'Daily English';
    const lessonId = await insertLesson(env, {
      band,
      kind: 'VOCAB',
      unitKey: `everyday-${day}-${band}`,
      unitTitle: 'Everyday Lessons',
      unitBlurb: 'A fresh set of six lessons for today.',
      title: `${topic} — word set ${slot + 1}`,
      blurb: 'Six useful words with meanings, examples and quick recall drills.',
      payload,
      status: 'PUBLISHED',
      origin: 'PERSONAL_AI',
      ownerId: userId,
      createdBy: userId,
    });
    created.push({ lessonId, slot, quote: quoteFor(day, slot) });
  }
  await env.DB.batch(created.map((entry) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO learn_daily_lessons (user_id, day, band, slot, lesson_id, quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, day, band, entry.slot, entry.lessonId, entry.quote, now),
  ));
}

async function generateSet(env: Env, userId: string, band: LearnBand, day: string): Promise<void> {
  const random = seededRandom(`${userId}:${day}:${band}:everyday`);
  const kinds = shuffle(DAILY_KINDS, random);
  const topics = shuffle(VOCAB_TOPICS, random).slice(0, DAILY_LESSON_COUNT);
  let rawLessons: RawEverydayLesson[];
  try {
    const result = await completeJson<{ lessons?: RawEverydayLesson[] }>(env, {
      messages: buildEverydayLessonMessages({ band, kinds, topics, day }),
      temperature: 0.85,
      maxTokens: 20_000,
      timeoutMs: 90_000,
      reasoningEffort: 'medium',
    });
    rawLessons = Array.isArray(result.data?.lessons) ? result.data!.lessons! : [];
  } catch {
    // The AI is optional: fall back to the offline word-bank set so the learner
    // always gets their six lessons for the day.
    await generateOfflineSet(env, userId, band, day);
    return;
  }

  if (rawLessons.length < DAILY_LESSON_COUNT) {
    await generateOfflineSet(env, userId, band, day);
    return;
  }

  const now = nowIso();
  const created: Array<{ lessonId: string; slot: number; quote: string }> = [];
  const titles = new Set<string>();
  for (let slot = 0; slot < DAILY_LESSON_COUNT; slot += 1) {
    const raw = rawLessons[slot]!;
    const kind = isLessonKind(raw.kind) ? raw.kind : null;
    const expectedKind = kinds[slot]!;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
    const payload = kind === expectedKind ? normaliseLessonPayload(kind, raw.payload) : null;
    const validSize = payload && (kind === 'VOCAB'
      ? payload.kind === 'VOCAB' && payload.words.length === 6
      : lessonItemCount(payload) === 30);
    const validWritingTask = kind !== 'WRITING'
      || (payload?.kind === 'WRITING' && Boolean(payload.taskPrompt) && Boolean(payload.taskType));
    if (!kind || !payload || !validSize || !validWritingTask || !title || titles.has(title.toLowerCase())) {
      await generateOfflineSet(env, userId, band, day);
      return;
    }
    titles.add(title.toLowerCase());
    const lessonId = await insertLesson(env, {
      band,
      kind,
      unitKey: `everyday-${day}-${band}`,
      unitTitle: 'Everyday Lessons',
      unitBlurb: 'A fresh set of six AI-generated lessons for today.',
      title,
      blurb: typeof raw.blurb === 'string' ? raw.blurb.trim().slice(0, 240) : 'A short daily practice lesson.',
      payload,
      status: 'PUBLISHED',
      origin: 'PERSONAL_AI',
      ownerId: userId,
      createdBy: userId,
    });
    created.push({ lessonId, slot, quote: quoteFor(day, slot) });
  }

  await env.DB.batch(created.map((entry) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO learn_daily_lessons (user_id, day, band, slot, lesson_id, quote, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(userId, day, band, entry.slot, entry.lessonId, entry.quote, now),
  ));
}

/**
 * Returns the learner's six ordered lessons for the day, creating them once on
 * first visit. Lesson bodies stay private to their owner and the next slot is
 * locked until the previous lesson is finished.
 */
export async function getEverydayLessons(env: Env, userId: string, band: LearnBand, day: string): Promise<EverydayLessonsResponse> {
  await ensureCatalogue(env);
  const existing = await readSet(env, userId, band, day);
  if (existing) return existing;
  await generateSet(env, userId, band, day);
  const generated = await readSet(env, userId, band, day);
  if (!generated) throw new ApiError('INTERNAL', 'Today’s lesson set could not be saved. Please try again.');
  return generated;
}
