CREATE TABLE IF NOT EXISTS assignment_marking_deadlines (
 assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
 deadline_at TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
