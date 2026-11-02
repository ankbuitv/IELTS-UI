CREATE TABLE IF NOT EXISTS school_teacher_competencies (
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subjects TEXT NOT NULL DEFAULT '', credentials TEXT NOT NULL DEFAULT '', experience TEXT NOT NULL DEFAULT '',
 shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1)), updated_at TEXT NOT NULL,
 PRIMARY KEY(school_id,teacher_id)
);
