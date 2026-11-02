CREATE TABLE IF NOT EXISTS school_teacher_transfers (
 id TEXT PRIMARY KEY,school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 from_user_id TEXT NOT NULL REFERENCES users(id),to_user_id TEXT NOT NULL REFERENCES users(id),
 requested_by TEXT NOT NULL REFERENCES users(id),from_accepted INTEGER NOT NULL DEFAULT 0 CHECK(from_accepted IN (0,1)),
 to_accepted INTEGER NOT NULL DEFAULT 0 CHECK(to_accepted IN (0,1)),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DECLINED','CANCELLED','APPLIED')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,execution_id TEXT,
 CHECK(from_user_id<>to_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_teacher_transfer ON school_teacher_transfers(classroom_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_teacher_transfer_school ON school_teacher_transfers(school_id,created_at DESC);
