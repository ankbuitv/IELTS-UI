CREATE TABLE IF NOT EXISTS teacher_task_retention (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 retention_days INTEGER NOT NULL CHECK(retention_days IN (90,180,365)),updated_at TEXT NOT NULL
);
-- Transactional guard: a restore either fits the personal task limit or rolls back.
CREATE TABLE IF NOT EXISTS teacher_backup_restore_guards (
 id TEXT PRIMARY KEY,total INTEGER NOT NULL CHECK(total<=500)
);
