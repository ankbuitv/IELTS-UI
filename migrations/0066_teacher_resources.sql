CREATE TABLE IF NOT EXISTS teacher_resources (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,
 subject TEXT NOT NULL DEFAULT '',
 topic TEXT NOT NULL DEFAULT '',
 shared_classroom_id TEXT REFERENCES classrooms(id) ON DELETE SET NULL,
 data_b64 TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_resources_author ON teacher_resources(author_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_resources_class ON teacher_resources(shared_classroom_id,updated_at DESC);
