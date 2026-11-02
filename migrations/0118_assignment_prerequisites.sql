CREATE TABLE IF NOT EXISTS assignment_prerequisites (
 assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
 prerequisite_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 CHECK(assignment_id<>prerequisite_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_prerequisites_parent ON assignment_prerequisites(prerequisite_id);
