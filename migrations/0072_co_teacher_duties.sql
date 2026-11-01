CREATE TABLE IF NOT EXISTS classroom_co_teacher_duties (
 member_id TEXT PRIMARY KEY REFERENCES classroom_members(id) ON DELETE CASCADE,
 can_grade INTEGER NOT NULL DEFAULT 1 CHECK(can_grade IN (0,1)),
 can_attend INTEGER NOT NULL DEFAULT 1 CHECK(can_attend IN (0,1)),
 can_resource INTEGER NOT NULL DEFAULT 1 CHECK(can_resource IN (0,1)),
 updated_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL
);
