CREATE TABLE IF NOT EXISTS assignment_change_history (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','ARCHIVE')),
 before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignment_change_history ON assignment_change_history(assignment_id,created_at DESC,id DESC);
