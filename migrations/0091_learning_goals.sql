CREATE TABLE IF NOT EXISTS learning_goals (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 week_start TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_goals_user_week ON learning_goals(user_id,week_start,created_at);
