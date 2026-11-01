CREATE TABLE IF NOT EXISTS classroom_teaching_events (
 id TEXT PRIMARY KEY,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 teacher_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_teaching_events ON classroom_teaching_events(classroom_id,starts_at);
CREATE INDEX IF NOT EXISTS idx_teacher_teaching_events ON classroom_teaching_events(teacher_id,starts_at);
