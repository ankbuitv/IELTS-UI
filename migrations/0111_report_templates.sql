CREATE TABLE IF NOT EXISTS teacher_report_templates (
 id TEXT PRIMARY KEY,author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,title TEXT NOT NULL,feedback TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_report_templates ON teacher_report_templates(author_id,updated_at DESC,id DESC);
