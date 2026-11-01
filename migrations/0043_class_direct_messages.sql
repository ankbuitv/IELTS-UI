-- Private conversations between current members of a mentor-led class.
CREATE TABLE IF NOT EXISTS class_direct_messages (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES mentor_classes(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_class_dm_pair ON class_direct_messages (class_id, sender_id, recipient_id, created_at);
