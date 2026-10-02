-- =============================================================================
-- Learn path, richer vocabulary notebook and dictionary cache.
--
-- 1. `vocabulary_entries` gains the fields a flash-card needs (part of speech,
--    pronunciation, example, Vietnamese gloss, approximate band) and a Leitner
--    box so a word comes back for review when it is due.
-- 2. `learn_profiles` / `learn_lessons_done` / `learn_xp_log` hold the
--    Duolingo-style progress: XP, daily streak, daily goal and the stars earned
--    in each lesson. The lessons themselves are static content shipped in the
--    client bundle (`src/shared/learn-content.ts`), so no lesson text lives here.
-- 3. `dictionary_cache` remembers dictionary look-ups. The data is public
--    reference material, shared by every user, never personal.
-- =============================================================================

ALTER TABLE vocabulary_entries ADD COLUMN meaning_vi TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_entries ADD COLUMN pos        TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_entries ADD COLUMN phonetic   TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_entries ADD COLUMN example    TEXT NOT NULL DEFAULT '';
ALTER TABLE vocabulary_entries ADD COLUMN level      REAL;
ALTER TABLE vocabulary_entries ADD COLUMN origin     TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE vocabulary_entries ADD COLUMN box        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vocabulary_entries ADD COLUMN due_at     TEXT;

CREATE INDEX idx_vocabulary_due ON vocabulary_entries (user_id, due_at);

CREATE TABLE learn_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  xp              INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  best_streak     INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  daily_goal_xp   INTEGER NOT NULL DEFAULT 30,
  start_band      REAL,
  last_words_day  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE learn_lessons_done (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id         TEXT NOT NULL,
  stars             INTEGER NOT NULL DEFAULT 0,
  best_accuracy     REAL NOT NULL DEFAULT 0,
  completions       INTEGER NOT NULL DEFAULT 0,
  xp_earned         INTEGER NOT NULL DEFAULT 0,
  last_completed_at TEXT NOT NULL,
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE learn_xp_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  xp         INTEGER NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_learn_xp_user_day ON learn_xp_log (user_id, day);

CREATE TABLE dictionary_cache (
  term         TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  source       TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);
