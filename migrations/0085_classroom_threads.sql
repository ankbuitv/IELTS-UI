CREATE TABLE IF NOT EXISTS classroom_message_replies (
 message_id TEXT PRIMARY KEY REFERENCES classroom_messages(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 root_id TEXT NOT NULL REFERENCES classroom_messages(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classroom_thread_replies ON classroom_message_replies(classroom_id,root_id,created_at,message_id);
