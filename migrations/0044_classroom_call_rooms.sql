-- A teacher-owned classroom has one reusable room; membership remains the
-- source of truth for access (no copied or stale participant list).
CREATE TABLE IF NOT EXISTS classroom_call_rooms (
  classroom_id TEXT PRIMARY KEY REFERENCES classrooms(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES mentor_sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
