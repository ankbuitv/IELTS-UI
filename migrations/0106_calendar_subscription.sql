CREATE TABLE IF NOT EXISTS teacher_calendar_subscriptions (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
