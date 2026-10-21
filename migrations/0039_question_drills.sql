-- #6 Question-type drills: short, standalone sets that practise one question
-- format at a time. The snapshot is stored so a submitted drill keeps its own
-- questions even if the paper is republished.
CREATE TABLE IF NOT EXISTS drill_attempts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_type TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  answers_json  TEXT,
  correct       INTEGER,
  total         INTEGER,
  created_at    TEXT NOT NULL,
  submitted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_drill_attempts_user ON drill_attempts (user_id, created_at);
