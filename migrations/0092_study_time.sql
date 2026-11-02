CREATE TABLE IF NOT EXISTS learning_study_time (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 skill TEXT NOT NULL CHECK(skill IN ('READING','LISTENING','WRITING','SPEAKING')),
 minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 600),
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_study_time_user_day ON learning_study_time(user_id,day);
