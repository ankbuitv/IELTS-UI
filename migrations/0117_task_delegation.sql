CREATE TABLE IF NOT EXISTS teacher_task_delegations (
 task_id TEXT PRIMARY KEY REFERENCES teacher_tasks(id) ON DELETE CASCADE,
 school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 delegate_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_task_delegations_recipient ON teacher_task_delegations(delegate_id,expires_at);
