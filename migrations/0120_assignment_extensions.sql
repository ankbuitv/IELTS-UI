CREATE TABLE IF NOT EXISTS assignment_extensions (
 assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 deadline_at TEXT NOT NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(assignment_id,student_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_extensions_deadline ON assignment_extensions(assignment_id,deadline_at);
