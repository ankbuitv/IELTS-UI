CREATE TABLE IF NOT EXISTS assignment_milestones (
 id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 title TEXT NOT NULL,due_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_milestones ON assignment_milestones(assignment_id,due_at,id);
CREATE TABLE IF NOT EXISTS assignment_milestone_checks (
 milestone_id TEXT NOT NULL REFERENCES assignment_milestones(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,checked_at TEXT NOT NULL,
 PRIMARY KEY(milestone_id,student_id)
);
