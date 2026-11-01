CREATE TABLE IF NOT EXISTS school_lesson_plan_versions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES school_lesson_plans(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, subject TEXT NOT NULL, week INTEGER, content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_versions_plan ON school_lesson_plan_versions(plan_id, created_at DESC);
CREATE TABLE IF NOT EXISTS school_lesson_submissions (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  plan_id TEXT NOT NULL REFERENCES school_lesson_plans(id),
  group_id TEXT NOT NULL REFERENCES school_subject_groups(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, subject TEXT NOT NULL, week INTEGER, content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','RETURNED')),
  reviewer_id TEXT REFERENCES users(id),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lesson_submissions_school ON school_lesson_submissions(school_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_submissions_pending ON school_lesson_submissions(plan_id) WHERE status='PENDING';
