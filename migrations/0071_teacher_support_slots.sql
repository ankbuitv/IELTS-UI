CREATE TABLE IF NOT EXISTS teacher_support_slots (
 id TEXT PRIMARY KEY,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','BOOKED','CANCELLED')),
 student_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 student_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_support_class ON teacher_support_slots(classroom_id,starts_at,status);
CREATE INDEX IF NOT EXISTS idx_teacher_support_teacher ON teacher_support_slots(teacher_id,starts_at,status);
CREATE INDEX IF NOT EXISTS idx_teacher_support_student ON teacher_support_slots(student_id,starts_at,status);
