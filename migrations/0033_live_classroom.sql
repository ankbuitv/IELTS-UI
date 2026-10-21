-- ---------------------------------------------------------------------------
-- 0033 — live classroom toolkit
--
-- Polls/quizzes, breakout rooms, the shared whiteboard and the weekly digest
-- bookkeeping. Also widens the signalling table: the original CHECK only
-- allowed SDP/ICE kinds, so reactions and in-call mute/kick signals were
-- rejected by SQLite even though the API accepted them.
-- ---------------------------------------------------------------------------

-- A poll or quiz launched inside one live room.
CREATE TABLE IF NOT EXISTS class_polls (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  room_key      TEXT NOT NULL DEFAULT 'main',
  created_by    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'QUIZ' CHECK (kind IN ('QUIZ', 'POLL')),
  question      TEXT NOT NULL,
  options_json  TEXT NOT NULL,
  correct_index INTEGER,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at    TEXT NOT NULL,
  closed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_class_polls_session ON class_polls (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS class_poll_answers (
  poll_id      TEXT NOT NULL REFERENCES class_polls (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  choice_index INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

-- A breakout room: a named sub-room of the same live session. The room_key is
-- what separates presence + WebRTC signalling between rooms.
CREATE TABLE IF NOT EXISTS class_breakouts (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  room_key   TEXT NOT NULL,
  ends_at    TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, room_key)
);
CREATE INDEX IF NOT EXISTS idx_class_breakouts_session ON class_breakouts (session_id);

CREATE TABLE IF NOT EXISTS class_breakout_members (
  breakout_id TEXT NOT NULL REFERENCES class_breakouts (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (breakout_id, user_id)
);

-- One board per session + room. Strokes are kept as JSON so the whole board is
-- one row: a whiteboard is small, and last-write-wins with a revision counter
-- is enough for a classroom.
CREATE TABLE IF NOT EXISTS class_whiteboards (
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  room_key   TEXT NOT NULL DEFAULT 'main',
  revision   INTEGER NOT NULL DEFAULT 0,
  strokes_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, room_key)
);

-- One row per user per ISO week keeps the scheduled digest idempotent.
CREATE TABLE IF NOT EXISTS user_digests (
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, week_key)
);

-- ---------------------------------------------------------------------------
-- Signalling: allow the in-call actions the API already exposes, and separate
-- rooms (main vs breakout) so an offer in room A never reaches room B.
-- ---------------------------------------------------------------------------
CREATE TABLE mentor_signals_next (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id  TEXT,
  room_key   TEXT NOT NULL DEFAULT 'main',
  kind       TEXT NOT NULL CHECK (kind IN ('OFFER', 'ANSWER', 'CANDIDATE', 'BYE', 'HAND', 'MUTE_MIC', 'UNMUTE_MIC', 'KICK', 'REACTION', 'WHITEBOARD')),
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO mentor_signals_next (id, session_id, sender_id, target_id, room_key, kind, payload, created_at)
SELECT id, session_id, sender_id, target_id, 'main', kind, payload, created_at FROM mentor_signals;
DROP TABLE mentor_signals;
ALTER TABLE mentor_signals_next RENAME TO mentor_signals;
CREATE INDEX idx_mentor_signals_session ON mentor_signals (session_id, room_key, created_at);

ALTER TABLE mentor_room_presence ADD COLUMN room_key TEXT NOT NULL DEFAULT 'main';
CREATE INDEX idx_mentor_presence_room ON mentor_room_presence (session_id, room_key, last_seen_at);
