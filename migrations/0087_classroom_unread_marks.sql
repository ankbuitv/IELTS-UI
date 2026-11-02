CREATE TABLE IF NOT EXISTS classroom_unread_marks (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES classroom_messages(id) ON DELETE CASCADE,
 marked_at TEXT NOT NULL,
 PRIMARY KEY(user_id,classroom_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_unread_user ON classroom_unread_marks(user_id,classroom_id,marked_at DESC);
