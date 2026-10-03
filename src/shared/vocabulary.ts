/**
 * Vocabulary notebook, shared between the API and the client.
 *
 * A candidate saves a word while reading a passage, listening to a transcript
 * or reading an explanation panel; the notebook then acts as a revision list
 * with a lightweight self-test (flip the card, mark it reviewed).
 */
export type VocabularyOrigin = 'USER' | 'AI' | 'WORDBANK';

export interface VocabularyEntry {
  id: string;
  term: string;
  meaning: string;
  /** Vietnamese gloss ('' when unknown). */
  meaningVi: string;
  pos: string;
  phonetic: string;
  example: string;
  /** Approximate IELTS band the word belongs to, when known. */
  level: number | null;
  /** Who added the word: the learner, the AI judges/coach, or the built-in word bank. */
  origin: VocabularyOrigin;
  /** Leitner box 0 (new) … 5 (known well). */
  box: number;
  /** When the word is next due for review; null means it is due now. */
  dueAt: string | null;
  note: string | null;
  source: string | null;
  reviewCount: number;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Days until a word returns, by Leitner box. */
export const LEITNER_DAYS = [0, 1, 2, 4, 8, 16] as const;
export const MAX_LEITNER_BOX = LEITNER_DAYS.length - 1;

/** The box a word moves to after a review, and the day offset until it is due again. */
export function nextLeitner(box: number, correct: boolean): { box: number; days: number } {
  const next = correct ? Math.min(MAX_LEITNER_BOX, box + 1) : Math.max(0, box - 1);
  return { box: next, days: correct ? LEITNER_DAYS[next]! : 0 };
}

export interface VocabularyList {
  entries: VocabularyEntry[];
  totals: {
    entries: number;
    reviewed: number;
    /** Words due for review right now. */
    due: number;
    /** Entries added in the last seven days. */
    thisWeek: number;
  };
}

export const VOCABULARY_TERM_MAX = 80;
export const VOCABULARY_MEANING_MAX = 600;
export const VOCABULARY_NOTE_MAX = 600;
export const VOCABULARY_SOURCE_MAX = 200;
