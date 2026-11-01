-- Shared classroom seating order, independent of attendance or call presence.
CREATE TABLE IF NOT EXISTS classroom_seating (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0 AND position < 200),
  PRIMARY KEY(classroom_id,student_id),
  UNIQUE(classroom_id,position)
);
