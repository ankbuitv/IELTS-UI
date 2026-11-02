CREATE TABLE IF NOT EXISTS writing_feedback_status (
 version_id TEXT NOT NULL REFERENCES writing_review_versions(id) ON DELETE CASCADE,
 comment_index INTEGER NOT NULL CHECK(comment_index BETWEEN 0 AND 99),
 status TEXT NOT NULL CHECK(status IN ('UNDERSTOOD','QUESTION')),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(version_id,comment_index)
);
CREATE TABLE IF NOT EXISTS writing_feedback_messages (
 id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES writing_review_versions(id) ON DELETE CASCADE,
 comment_index INTEGER NOT NULL CHECK(comment_index BETWEEN 0 AND 99),
 author_id TEXT NOT NULL REFERENCES users(id), author_type TEXT NOT NULL CHECK(author_type IN ('STUDENT','TEACHER')),
 body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_feedback_messages ON writing_feedback_messages(version_id,comment_index,created_at,id);
