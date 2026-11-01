-- School management is an explicitly granted capability, not a self-selected role.
CREATE TABLE IF NOT EXISTS school_managers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL
);
