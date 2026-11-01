CREATE TABLE IF NOT EXISTS school_staff_permissions (
  school_id TEXT NOT NULL REFERENCES schools(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL CHECK(permission IN ('MANAGE_GROUPS','MANAGE_CALENDAR','REVIEW_ALL')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY(school_id,user_id,permission)
);
