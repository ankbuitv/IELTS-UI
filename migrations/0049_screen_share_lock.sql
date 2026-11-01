CREATE TABLE IF NOT EXISTS call_screen_shares (
  session_id TEXT NOT NULL REFERENCES mentor_sessions(id),
  room_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, room_key)
);
