-- Per-account desktop layout; private to the signed-in user.
CREATE TABLE IF NOT EXISTS school_desktop_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
