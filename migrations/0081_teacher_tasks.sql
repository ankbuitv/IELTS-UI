-- Private teacher to-dos; dates are local calendar dates, not UTC timestamps.
CREATE TABLE IF NOT EXISTS teacher_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('HIGH','NORMAL','LOW')),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_tasks_user ON teacher_tasks(user_id,completed,due_date,priority);
