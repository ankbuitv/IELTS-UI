-- Personal lesson plans of active staff at an approved school.
CREATE TABLE IF NOT EXISTS school_lesson_plans (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  week INTEGER,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_lesson_plans_owner ON school_lesson_plans(school_id, author_id, updated_at DESC);
