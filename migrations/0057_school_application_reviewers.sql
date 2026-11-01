-- Platform admins can delegate school-application review without granting admin.
CREATE TABLE IF NOT EXISTS school_application_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL
);
