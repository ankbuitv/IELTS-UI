CREATE TABLE IF NOT EXISTS writing_review_versions (
 id TEXT PRIMARY KEY,
 writing_submission_id TEXT NOT NULL REFERENCES writing_submissions(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 10),
 response_text TEXT NOT NULL,
 feedback_json TEXT NOT NULL DEFAULT '[]',
 state TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(state IN ('SUBMITTED','RETURNED')),
 created_at TEXT NOT NULL,
 reviewed_at TEXT,
 reviewed_by TEXT REFERENCES users(id),
 UNIQUE(writing_submission_id,version)
);
CREATE INDEX IF NOT EXISTS idx_writing_review ON writing_review_versions(writing_submission_id,version DESC);
