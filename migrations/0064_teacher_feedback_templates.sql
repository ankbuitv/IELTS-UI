CREATE TABLE IF NOT EXISTS teacher_feedback_templates (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_feedback_author ON teacher_feedback_templates(author_id,created_at DESC);
