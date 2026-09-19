-- =============================================================================
-- Vocabulary notebook: the words a candidate collects while working through
-- passages, transcripts and explanation panels. One row per (user, term), so
-- saving the same word twice updates its definition instead of duplicating it.
-- =============================================================================

CREATE TABLE vocabulary_entries (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  term         TEXT NOT NULL,
  meaning      TEXT NOT NULL DEFAULT '',
  note         TEXT,
  source       TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_vocabulary_user_term ON vocabulary_entries (user_id, term);
CREATE INDEX idx_vocabulary_user_created ON vocabulary_entries (user_id, created_at DESC);
