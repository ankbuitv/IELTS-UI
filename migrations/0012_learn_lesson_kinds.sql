-- =============================================================================
-- Widen `learn_lessons.kind` from vocabulary only to the five lesson kinds.
--
-- Migration 0011 shipped the catalogue with `CHECK (kind IN ('VOCAB'))` because
-- that was all the path had. A band score does not turn on vocabulary alone, so
-- the catalogue gains paraphrase, reading, writing and speaking lessons, each
-- with its own body shape inside `payload_json`.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt the
-- same way migration 0003 rebuilt `assets`: create the new shape, copy every row
-- across, drop the old table, rename. Foreign keys are deferred for the swap and
-- the indexes are recreated afterwards, because an index on a dropped table
-- would abort the batch.
--
-- `learn_lessons_done` keys on the lesson *id* as text rather than by foreign
-- key, so a learner's stars and completions survive the swap untouched.
-- =============================================================================

PRAGMA defer_foreign_keys = ON;

CREATE TABLE learn_lessons_v2 (
  id           TEXT PRIMARY KEY,
  band         REAL NOT NULL,
  unit_key     TEXT NOT NULL,
  unit_title   TEXT NOT NULL DEFAULT '',
  unit_blurb   TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  blurb        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'VOCAB'
               CHECK (kind IN ('VOCAB', 'PARAPHRASE', 'READING', 'WRITING', 'SPEAKING')),
  payload_json TEXT NOT NULL,
  origin       TEXT NOT NULL DEFAULT 'BUILT_IN'
               CHECK (origin IN ('BUILT_IN', 'ADMIN_AI', 'PERSONAL_AI')),
  status       TEXT NOT NULL DEFAULT 'PUBLISHED'
               CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  owner_id     TEXT REFERENCES users (id) ON DELETE CASCADE,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO learn_lessons_v2 (id, band, unit_key, unit_title, unit_blurb, position, title, blurb,
                              kind, payload_json, origin, status, owner_id, created_by,
                              created_at, updated_at)
SELECT id, band, unit_key, unit_title, unit_blurb, position, title, blurb,
       kind, payload_json, origin, status, owner_id, created_by,
       created_at, updated_at
  FROM learn_lessons;

DROP TABLE learn_lessons;
ALTER TABLE learn_lessons_v2 RENAME TO learn_lessons;

CREATE INDEX idx_learn_lessons_band ON learn_lessons (band, status, position);
CREATE INDEX idx_learn_lessons_owner ON learn_lessons (owner_id, band);

PRAGMA defer_foreign_keys = OFF;
