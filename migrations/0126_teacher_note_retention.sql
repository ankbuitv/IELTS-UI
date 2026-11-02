CREATE TABLE IF NOT EXISTS teacher_note_retention (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 retention_days INTEGER NOT NULL CHECK(retention_days IN (90,180,365)),
 updated_at TEXT NOT NULL
);
