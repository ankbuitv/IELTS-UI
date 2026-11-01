CREATE TABLE IF NOT EXISTS classroom_announcements (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classroom_announcements ON classroom_announcements(classroom_id,pinned DESC,created_at DESC);
CREATE TABLE IF NOT EXISTS classroom_announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES classroom_announcements(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY(announcement_id,student_id)
);
CREATE TABLE IF NOT EXISTS classroom_polls (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  question TEXT NOT NULL,
  choices_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classroom_polls ON classroom_polls(classroom_id,created_at DESC);
CREATE TABLE IF NOT EXISTS classroom_poll_votes (
  poll_id TEXT NOT NULL REFERENCES classroom_polls(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(poll_id,student_id)
);
