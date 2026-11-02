-- Private teacher-owned classroom support history; never a school-wide report.
CREATE TABLE IF NOT EXISTS teacher_interventions (
 id TEXT PRIMARY KEY,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 occurred_on TEXT NOT NULL,
 action TEXT NOT NULL,
 outcome TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_interventions_lookup ON teacher_interventions(author_id,classroom_id,student_id,occurred_on DESC);
