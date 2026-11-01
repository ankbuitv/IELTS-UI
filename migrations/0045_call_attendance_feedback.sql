-- Attendance is based on explicit joins and heartbeats; it is not proof of attention.
CREATE TABLE IF NOT EXISTS call_attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  left_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_attendance_open ON call_attendance(session_id, user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_call_attendance_session ON call_attendance(session_id, joined_at DESC);
CREATE TABLE IF NOT EXISTS call_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions(id) ON DELETE CASCADE,
  attendance_id TEXT NOT NULL UNIQUE REFERENCES call_attendance(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_feedback_session ON call_feedback(session_id, created_at DESC);
