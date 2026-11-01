-- A monotonic sequence is required for polling. Random signal IDs are not clocks.
CREATE TABLE mentor_signals_ordered (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id TEXT,
  room_key TEXT NOT NULL DEFAULT 'main',
  kind TEXT NOT NULL CHECK (kind IN ('OFFER', 'ANSWER', 'CANDIDATE', 'BYE', 'HAND', 'MUTE_MIC', 'UNMUTE_MIC', 'KICK', 'REACTION', 'WHITEBOARD')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO mentor_signals_ordered (id, session_id, sender_id, target_id, room_key, kind, payload, created_at)
  SELECT id, session_id, sender_id, target_id, room_key, kind, payload, created_at FROM mentor_signals ORDER BY rowid;
DROP TABLE mentor_signals;
ALTER TABLE mentor_signals_ordered RENAME TO mentor_signals;
CREATE INDEX idx_mentor_signals_session ON mentor_signals (session_id, room_key, seq);
-- Rebuild works even when runtime schema healing has already added screen_on.
CREATE TABLE mentor_room_presence_next (
  session_id TEXT NOT NULL REFERENCES mentor_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hand_raised INTEGER NOT NULL DEFAULT 0,
  room_key TEXT NOT NULL DEFAULT 'main',
  cam_on INTEGER NOT NULL DEFAULT 1,
  mic_on INTEGER NOT NULL DEFAULT 1,
  screen_on INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id)
);
INSERT INTO mentor_room_presence_next (session_id,user_id,joined_at,last_seen_at,hand_raised,room_key,cam_on,mic_on)
  SELECT session_id,user_id,joined_at,last_seen_at,hand_raised,room_key,cam_on,mic_on FROM mentor_room_presence;
DROP TABLE mentor_room_presence;
ALTER TABLE mentor_room_presence_next RENAME TO mentor_room_presence;
CREATE INDEX idx_mentor_presence_room ON mentor_room_presence (session_id, room_key, last_seen_at);
