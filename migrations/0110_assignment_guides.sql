CREATE TABLE IF NOT EXISTS assignment_guides (
 id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,bytes INTEGER NOT NULL,data_b64 TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_guides_assignment ON assignment_guides(assignment_id,created_at,id);
