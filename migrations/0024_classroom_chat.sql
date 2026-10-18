-- 0024: course-level chat.
--
-- Every teacher classroom (a "khoá học" from the learner's point of view) gets
-- its own message stream, mirroring the mentor class chat that already exists.
-- Members, the classroom teacher and admins can read and post.

CREATE TABLE IF NOT EXISTS classroom_messages (
  id         TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classroom_messages_classroom
  ON classroom_messages (classroom_id, created_at DESC);
