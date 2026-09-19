/**
 * Vocabulary notebook, shared between the API and the client.
 *
 * A candidate saves a word while reading a passage, listening to a transcript
 * or reading an explanation panel; the notebook then acts as a revision list
 * with a lightweight self-test (flip the card, mark it reviewed).
 */
export interface VocabularyEntry {
  id: string;
  term: string;
  meaning: string;
  note: string | null;
  source: string | null;
  reviewCount: number;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VocabularyList {
  entries: VocabularyEntry[];
  totals: {
    entries: number;
    reviewed: number;
    /** Entries added in the last seven days. */
    thisWeek: number;
  };
}

export const VOCABULARY_TERM_MAX = 80;
export const VOCABULARY_MEANING_MAX = 600;
export const VOCABULARY_NOTE_MAX = 600;
export const VOCABULARY_SOURCE_MAX = 200;
