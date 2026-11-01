CREATE TABLE IF NOT EXISTS attempt_question_feedback (
 attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
 question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(attempt_id,question_id)
);
