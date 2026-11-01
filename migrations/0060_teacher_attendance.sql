-- Manual teacher attendance, independent of call-presence telemetry.
CREATE TABLE IF NOT EXISTS classroom_attendance (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE')),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(classroom_id,student_id,attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_classroom_attendance_dates ON classroom_attendance(classroom_id,attendance_date DESC);
