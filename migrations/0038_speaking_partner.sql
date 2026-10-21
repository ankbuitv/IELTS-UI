-- AI speaking partner: turn-based rehearsal with per-turn coaching.
-- A session belongs to one learner and one topic from SPEAKING_PARTNER_TOPICS.
CREATE TABLE IF NOT EXISTS speaking_partner_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL,
  topic_title  TEXT NOT NULL,
  part         INTEGER NOT NULL CHECK (part BETWEEN 1 AND 3),
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED')),
  summary_json TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_speaking_partner_sessions_user
  ON speaking_partner_sessions (user_id, updated_at);

CREATE TABLE IF NOT EXISTS speaking_partner_turns (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES speaking_partner_sessions (id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('PARTNER', 'CANDIDATE')),
  content       TEXT NOT NULL,
  feedback_json TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_speaking_partner_turns_session
  ON speaking_partner_turns (session_id, seq);
