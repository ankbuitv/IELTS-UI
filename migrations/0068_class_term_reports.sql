CREATE TABLE IF NOT EXISTS class_term_report_drafts (
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 from_date TEXT NOT NULL,
 to_date TEXT NOT NULL,
 feedback TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(classroom_id,student_id)
);
CREATE TABLE IF NOT EXISTS class_term_report_releases (
 id TEXT PRIMARY KEY,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 from_date TEXT NOT NULL,
 to_date TEXT NOT NULL,
 feedback TEXT NOT NULL,
 summary_json TEXT NOT NULL,
 approved_by TEXT NOT NULL REFERENCES users(id),
 approved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_term_report_release ON class_term_report_releases(classroom_id,student_id,approved_at DESC);
