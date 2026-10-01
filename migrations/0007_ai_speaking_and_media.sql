-- =============================================================================
-- AI marking, Speaking practice, inline media and per-section marker support.
--
-- 1. `writing_scores.scoring_source` gains 'AI'. SQLite cannot change a CHECK
--    constraint in place, so the table is rebuilt (same columns, same indexes).
-- 2. `ai_scores` is one audit table for every AI judgement the platform makes
--    (Writing feedback, Speaking feedback, and future question generation). It
--    keeps the provider and model that produced it, so a band can always be
--    explained and a change of provider is traceable.
-- 3. Speaking practice: a session holds up to three parts (interview, long
--    turn, discussion); each part stores its transcript, timing and, when the
--    candidate allowed recording, the audio itself in `speaking_recording_blobs`
--    (base64 in D1 — V1 deliberately has no object storage).
-- 4. `asset_blobs` lets an administrator *upload* listening audio or an image
--    instead of pasting a URL. `assets.storage_kind` already allows
--    'OBJECT_STORAGE'; that kind now means "served from D1 by /api/files/:id"
--    and supports HTTP Range requests so the exam player can seek.
--    Audio is stored in chunks: D1 caps a single SQL statement, so one row per
--    ~36 KB of binary keeps every write inside the limit while the reader
--    reassembles the file and slices the requested byte range.
-- =============================================================================

PRAGMA defer_foreign_keys = ON;

-- 1. Writing scores may now come from the AI grader -------------------------
CREATE TABLE writing_scores_v2 (
  id                    TEXT PRIMARY KEY,
  writing_submission_id TEXT NOT NULL UNIQUE REFERENCES writing_submissions (id) ON DELETE CASCADE,
  band                  REAL,
  criteria_json         TEXT NOT NULL DEFAULT '{}',
  feedback              TEXT NOT NULL DEFAULT '',
  scoring_source        TEXT NOT NULL CHECK (scoring_source IN ('TEACHER', 'ADMIN', 'IMPORTED', 'AI')),
  scored_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  scored_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

INSERT INTO writing_scores_v2 (id, writing_submission_id, band, criteria_json, feedback, scoring_source,
                               scored_by, scored_at, created_at, updated_at)
SELECT id, writing_submission_id, band, criteria_json, feedback, scoring_source,
       scored_by, scored_at, created_at, updated_at
  FROM writing_scores;

DROP TABLE writing_scores;
ALTER TABLE writing_scores_v2 RENAME TO writing_scores;
CREATE INDEX idx_writing_scores_source ON writing_scores (scoring_source);

-- 2. One audit table for every AI judgement --------------------------------
CREATE TABLE ai_scores (
  id                TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES users (id) ON DELETE SET NULL,
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('WRITING', 'SPEAKING', 'IMPORT', 'QUESTION')),
  entity_id         TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'BAND',
  provider_id       TEXT,
  provider_model    TEXT,
  band              REAL,
  criteria_json     TEXT NOT NULL DEFAULT '{}',
  feedback          TEXT NOT NULL DEFAULT '',
  raw_json          TEXT NOT NULL DEFAULT '{}',
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_ai_scores_entity ON ai_scores (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ai_scores_user ON ai_scores (user_id, created_at DESC);

-- 3. Speaking practice -----------------------------------------------------
CREATE TABLE speaking_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'PRACTICE' CHECK (mode IN ('PRACTICE', 'MOCK')),
  status         TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                 CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'MARKED', 'FAILED')),
  topic_set_id   TEXT NOT NULL,
  topic_title    TEXT NOT NULL DEFAULT '',
  part_count     INTEGER NOT NULL DEFAULT 3,
  overall_band   REAL,
  transcript     TEXT NOT NULL DEFAULT '',
  feedback       TEXT NOT NULL DEFAULT '',
  criteria_json  TEXT NOT NULL DEFAULT '{}',
  provider_id    TEXT,
  provider_model TEXT,
  marked_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_speaking_sessions_user ON speaking_sessions (user_id, created_at DESC);

CREATE TABLE speaking_responses (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES speaking_sessions (id) ON DELETE CASCADE,
  part             INTEGER NOT NULL CHECK (part IN (1, 2, 3)),
  prompt_text      TEXT NOT NULL DEFAULT '',
  transcript       TEXT NOT NULL DEFAULT '',
  duration_seconds REAL NOT NULL DEFAULT 0,
  words            INTEGER NOT NULL DEFAULT 0,
  mime             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (session_id, part)
);

-- Recording audio is optional and stays out of the relational rows: a candidate
-- who declines the microphone still gets transcript-based AI feedback. Audio is
-- chunked so no single SQL statement exceeds D1's statement-size limit.
CREATE TABLE speaking_recording_blobs (
  response_id TEXT NOT NULL REFERENCES speaking_responses (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'audio/webm',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (response_id, chunk_index)
);

-- 4. Uploaded media (listening audio, images) served from D1 ----------------
CREATE TABLE asset_blobs (
  asset_id    TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (asset_id, chunk_index)
);

-- 5. Per-section marking: each part stores its own marked score so the result
--    screen can report "Passage 2: 8/10" for partial practice sets and mocks.
ALTER TABLE attempt_sections ADD COLUMN raw_score INTEGER;
ALTER TABLE attempt_sections ADD COLUMN total_marked INTEGER;

PRAGMA defer_foreign_keys = OFF;
