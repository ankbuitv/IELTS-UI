-- 0026: personal calendar entries (study blocks, reminders, lesson notes).
--
-- The calendar page merges these with mentor sessions, class sessions and
-- assignment deadlines; only the owner can read or edit them.

CREATE TABLE IF NOT EXISTS calendar_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_starts
  ON calendar_events (user_id, starts_at);
