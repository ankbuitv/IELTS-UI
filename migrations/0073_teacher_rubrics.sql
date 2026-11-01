CREATE TABLE IF NOT EXISTS teacher_rubrics (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 skill TEXT NOT NULL CHECK(skill IN ('WRITING','SPEAKING')),
 title TEXT NOT NULL,
 criteria_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_rubrics_author ON teacher_rubrics(author_id,skill,updated_at DESC);
CREATE TABLE IF NOT EXISTS teacher_speaking_rubric_scores (
 session_id TEXT PRIMARY KEY REFERENCES speaking_sessions(id) ON DELETE CASCADE,
 criteria_json TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
