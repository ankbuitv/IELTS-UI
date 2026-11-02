CREATE TABLE IF NOT EXISTS learning_mistakes (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 skill TEXT NOT NULL CHECK(skill IN ('READING','LISTENING','WRITING','SPEAKING')),
 note TEXT NOT NULL DEFAULT '',
 occurrences INTEGER NOT NULL DEFAULT 1 CHECK(occurrences BETWEEN 1 AND 999),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_mistakes_user ON learning_mistakes(user_id,occurrences,updated_at);
