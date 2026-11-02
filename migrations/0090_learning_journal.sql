CREATE TABLE IF NOT EXISTS learning_journal (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 body TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,day)
);
