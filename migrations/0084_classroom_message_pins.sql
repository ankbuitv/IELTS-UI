CREATE TABLE IF NOT EXISTS classroom_message_pins (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES classroom_messages(id) ON DELETE CASCADE,
  pinned_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(classroom_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_message_pins ON classroom_message_pins(classroom_id,created_at DESC);
