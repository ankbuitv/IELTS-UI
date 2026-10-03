import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import {
  VOCABULARY_MEANING_MAX,
  VOCABULARY_NOTE_MAX,
  VOCABULARY_TERM_MAX,
  nextLeitner,
  type VocabularyEntry,
  type VocabularyList,
  type VocabularyOrigin,
} from '../../shared/vocabulary';

/**
 * Vocabulary notebook.
 *
 * Candidates collect words while they read a passage, follow a transcript or
 * read an explanation panel. The notebook is deliberately private to its owner:
 * every query is scoped by `user_id`, so one candidate can never read or change
 * another candidate's list. Saving a word that already exists updates the
 * definition in place (the unique index on `(user_id, term)` makes the upsert
 * safe under concurrent saves from two tabs).
 */

interface VocabularyRow {
  id: string;
  term: string;
  meaning: string;
  meaning_vi: string;
  pos: string;
  phonetic: string;
  example: string;
  level: number | null;
  origin: string;
  box: number;
  due_at: string | null;
  note: string | null;
  source: string | null;
  review_count: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toEntry(row: VocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    meaningVi: row.meaning_vi ?? '',
    pos: row.pos ?? '',
    phonetic: row.phonetic ?? '',
    example: row.example ?? '',
    level: row.level ?? null,
    origin: row.origin === 'AI' || row.origin === 'WORDBANK' ? row.origin : 'USER',
    box: row.box ?? 0,
    dueAt: row.due_at ?? null,
    note: row.note,
    source: row.source,
    reviewCount: row.review_count,
    lastReviewedAt: row.last_reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalise a term for storage and duplicate detection. */
export function normaliseTerm(term: string): string {
  return term.trim().replace(/\s+/g, ' ');
}

export async function listVocabulary(
  env: Env,
  userId: string,
  options: { search?: string | null; limit?: number } = {},
): Promise<VocabularyList> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const search = options.search?.trim() ?? '';
  const rows = await env.DB.prepare(
    `SELECT ${ROW_COLUMNS}
       FROM vocabulary_entries
      WHERE user_id = ?
        AND (? = '' OR lower(term) LIKE '%' || lower(?) || '%' OR lower(meaning) LIKE '%' || lower(?) || '%')
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(userId, search, search, search, limit)
    .all<VocabularyRow>();

  const entries = (rows.results ?? []).map(toEntry);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const nowStamp = nowIso();
  return {
    entries,
    totals: {
      entries: entries.length,
      reviewed: entries.filter((entry) => entry.reviewCount > 0).length,
      due: entries.filter((entry) => entry.dueAt === null || entry.dueAt <= nowStamp).length,
      thisWeek: entries.filter((entry) => entry.createdAt >= weekAgo).length,
    },
  };
}

export interface VocabularyInput {
  term: string;
  meaning?: string;
  meaningVi?: string;
  pos?: string;
  phonetic?: string;
  example?: string;
  level?: number | null;
  origin?: VocabularyOrigin;
  note?: string | null;
  source?: string | null;
}

export async function saveVocabularyEntry(env: Env, userId: string, input: VocabularyInput): Promise<VocabularyEntry> {
  const term = normaliseTerm(input.term);
  if (term.length === 0) throw ApiError.validation('A word or phrase is required.');

  const existing = await env.DB.prepare(
    'SELECT id, meaning, note, source FROM vocabulary_entries WHERE user_id = ? AND term = ? COLLATE NOCASE',
  )
    .bind(userId, term)
    .first<{ id: string; meaning: string; note: string | null; source: string | null }>();

  const now = nowIso();
  if (existing) {
    const meaning = (input.meaning ?? '').trim() || existing.meaning;
    const note = input.note === undefined ? existing.note : (input.note ?? '').trim() || null;
    const source = input.source === undefined ? existing.source : (input.source ?? '').trim() || null;
    await env.DB.prepare(
      `UPDATE vocabulary_entries
          SET meaning = ?, note = ?, source = ?,
              meaning_vi = CASE WHEN ? != '' THEN ? ELSE meaning_vi END,
              pos = CASE WHEN ? != '' THEN ? ELSE pos END,
              phonetic = CASE WHEN ? != '' THEN ? ELSE phonetic END,
              example = CASE WHEN ? != '' THEN ? ELSE example END,
              level = COALESCE(?, level),
              updated_at = ?
        WHERE id = ? AND user_id = ?`,
    )
      .bind(
        meaning,
        note,
        source,
        ...twice(clip(input.meaningVi, VOCABULARY_MEANING_MAX)),
        ...twice(clip(input.pos, 24)),
        ...twice(clip(input.phonetic, 80)),
        ...twice(clip(input.example, VOCABULARY_NOTE_MAX)),
        input.level ?? null,
        now,
        existing.id,
        userId,
      )
      .run();
    const row = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?')
      .bind(existing.id, userId)
      .first<VocabularyRow>();
    if (!row) throw ApiError.notFound('That word is no longer in your notebook.');
    return toEntry(row);
  }

  const id = newId('vocab');
  await env.DB.prepare(
    `INSERT INTO vocabulary_entries (id, user_id, term, meaning, meaning_vi, pos, phonetic, example, level, origin,
                                     box, due_at, note, source, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 0, ?, ?)`,
  )
    .bind(
      id,
      userId,
      term,
      (input.meaning ?? '').trim(),
      clip(input.meaningVi, VOCABULARY_MEANING_MAX),
      clip(input.pos, 24),
      clip(input.phonetic, 80),
      clip(input.example, VOCABULARY_NOTE_MAX),
      input.level ?? null,
      input.origin ?? 'USER',
      (input.note ?? '')?.trim() || null,
      (input.source ?? '')?.trim() || null,
      now,
      now,
    )
    .run();

  const row = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?').bind(id, userId).first<VocabularyRow>();
  if (!row) throw ApiError.notFound('The word could not be saved.');
  return toEntry(row);
}

export async function updateVocabularyEntry(
  env: Env,
  userId: string,
  id: string,
  input: { meaning?: string; note?: string | null; reviewed?: boolean; correct?: boolean },
): Promise<VocabularyEntry> {
  const row = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?').bind(id, userId).first<VocabularyRow>();
  if (!row) throw ApiError.notFound('That word is not in your notebook.');

  const now = nowIso();
  const meaning = input.meaning === undefined ? row.meaning : input.meaning.trim();
  const note = input.note === undefined ? row.note : (input.note ?? '').trim() || null;
  const reviewCount = input.reviewed ? row.review_count + 1 : row.review_count;
  const lastReviewedAt = input.reviewed ? now : row.last_reviewed_at;
  // A review moves the word between Leitner boxes: remembered words wait longer, forgotten ones come back now.
  const leitner = input.reviewed ? nextLeitner(row.box ?? 0, input.correct !== false) : null;
  const box = leitner ? leitner.box : (row.box ?? 0);
  const dueAt = leitner ? new Date(Date.now() + leitner.days * 86_400_000).toISOString() : row.due_at;

  await env.DB.prepare(
    `UPDATE vocabulary_entries
        SET meaning = ?, note = ?, review_count = ?, last_reviewed_at = ?, box = ?, due_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  )
    .bind(meaning, note, reviewCount, lastReviewedAt, box, dueAt, now, id, userId)
    .run();

  const updated = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?').bind(id, userId).first<VocabularyRow>();
  if (!updated) throw ApiError.notFound('That word is not in your notebook.');
  return toEntry(updated);
}

export async function deleteVocabularyEntry(env: Env, userId: string, id: string): Promise<void> {
  const result = await env.DB.prepare('DELETE FROM vocabulary_entries WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  if (!result.meta.changes) throw ApiError.notFound('That word is not in your notebook.');
}

const ROW_COLUMNS = `id, term, meaning, meaning_vi, pos, phonetic, example, level, origin, box, due_at,
   note, source, review_count, last_reviewed_at, created_at, updated_at`;
const ROW_SELECT = `SELECT ${ROW_COLUMNS} FROM vocabulary_entries`;

function clip(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

function twice(value: string): [string, string] {
  return [value, value];
}

/** A word suggested by the judges or by the vocabulary coach. */
export interface SuggestedWord {
  term: string;
  pos?: string;
  meaning?: string;
  meaningVi?: string;
  example?: string;
  phonetic?: string;
  level?: number | null;
}

/**
 * Adds suggested words to the notebook. A word the candidate already saved is
 * left exactly as they wrote it: an AI suggestion never overwrites their own
 * definition. Returns the number of words that were actually new.
 */
export async function saveAiVocabulary(
  env: Env,
  userId: string,
  words: SuggestedWord[],
  source: string,
  origin: VocabularyOrigin = 'AI',
): Promise<number> {
  let added = 0;
  for (const word of words.slice(0, 12)) {
    const term = normaliseTerm(word.term ?? '');
    if (!term || term.length > VOCABULARY_TERM_MAX) continue;
    const exists = await env.DB.prepare('SELECT id FROM vocabulary_entries WHERE user_id = ? AND term = ? COLLATE NOCASE')
      .bind(userId, term)
      .first<{ id: string }>();
    if (exists) continue;
    const meaning = clip(word.meaning, VOCABULARY_MEANING_MAX) || clip(word.meaningVi, VOCABULARY_MEANING_MAX);
    if (!meaning) continue;
    await saveVocabularyEntry(env, userId, {
      term,
      meaning,
      ...(word.meaningVi ? { meaningVi: word.meaningVi } : {}),
      ...(word.pos ? { pos: word.pos } : {}),
      ...(word.phonetic ? { phonetic: word.phonetic } : {}),
      ...(word.example ? { example: word.example } : {}),
      ...(word.level !== undefined ? { level: word.level } : {}),
      origin,
      source,
    });
    added += 1;
  }
  return added;
}
