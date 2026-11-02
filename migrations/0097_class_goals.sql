CREATE TABLE IF NOT EXISTS classroom_goals (
 id TEXT PRIMARY KEY,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 target_percent INTEGER NOT NULL CHECK(target_percent BETWEEN 1 AND 100),
 due_date TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classroom_goals_class ON classroom_goals(classroom_id,created_at DESC,id DESC);
