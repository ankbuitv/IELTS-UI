import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import type { VocabularyEntry, VocabularyList } from '../../shared/vocabulary';

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
    `SELECT id, term, meaning, note, source, review_count, last_reviewed_at, created_at, updated_at
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
  return {
    entries,
    totals: {
      entries: entries.length,
      reviewed: entries.filter((entry) => entry.reviewCount > 0).length,
      thisWeek: entries.filter((entry) => entry.createdAt >= weekAgo).length,
    },
  };
}

export async function saveVocabularyEntry(
  env: Env,
  userId: string,
  input: { term: string; meaning?: string; note?: string | null; source?: string | null },
): Promise<VocabularyEntry> {
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
      'UPDATE vocabulary_entries SET meaning = ?, note = ?, source = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    )
      .bind(meaning, note, source, now, existing.id, userId)
      .run();
    const row = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?')
      .bind(existing.id, userId)
      .first<VocabularyRow>();
    if (!row) throw ApiError.notFound('That word is no longer in your notebook.');
    return toEntry(row);
  }

  const id = newId('vocab');
  await env.DB.prepare(
    `INSERT INTO vocabulary_entries (id, user_id, term, meaning, note, source, review_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      id,
      userId,
      term,
      (input.meaning ?? '').trim(),
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
  input: { meaning?: string; note?: string | null; reviewed?: boolean },
): Promise<VocabularyEntry> {
  const row = await env.DB.prepare(ROW_SELECT + ' WHERE id = ? AND user_id = ?').bind(id, userId).first<VocabularyRow>();
  if (!row) throw ApiError.notFound('That word is not in your notebook.');

  const now = nowIso();
  const meaning = input.meaning === undefined ? row.meaning : input.meaning.trim();
  const note = input.note === undefined ? row.note : (input.note ?? '').trim() || null;
  const reviewCount = input.reviewed ? row.review_count + 1 : row.review_count;
  const lastReviewedAt = input.reviewed ? now : row.last_reviewed_at;

  await env.DB.prepare(
    `UPDATE vocabulary_entries
        SET meaning = ?, note = ?, review_count = ?, last_reviewed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  )
    .bind(meaning, note, reviewCount, lastReviewedAt, now, id, userId)
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

const ROW_SELECT = `SELECT id, term, meaning, note, source, review_count, last_reviewed_at, created_at, updated_at
   FROM vocabulary_entries`;
