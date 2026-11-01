-- Private draft attachments; submitted attachments are immutable snapshots.
CREATE TABLE IF NOT EXISTS school_lesson_attachments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES school_lesson_plans(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  data_b64 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_attachments_plan ON school_lesson_attachments(plan_id, active);
CREATE TABLE IF NOT EXISTS school_lesson_submission_attachments (
  submission_id TEXT NOT NULL REFERENCES school_lesson_submissions(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES school_lesson_attachments(id),
  PRIMARY KEY (submission_id, attachment_id)
);
