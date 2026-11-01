-- Private to the author, and readable only while they retain class access.
CREATE TABLE IF NOT EXISTS teacher_private_notes (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) <= 4000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(classroom_id,student_id,author_id)
);
