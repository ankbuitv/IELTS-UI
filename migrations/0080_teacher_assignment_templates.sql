CREATE TABLE IF NOT EXISTS teacher_assignment_templates (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 config_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_assignment_templates ON teacher_assignment_templates(author_id,updated_at DESC);
