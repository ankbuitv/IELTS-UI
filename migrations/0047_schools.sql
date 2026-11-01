-- School organisations and explicit teacher invitations. Existing classrooms
-- and sessions are untouched until a school is explicitly selected for them.
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS school_members (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'TEACHER')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INVITED', 'DECLINED', 'REMOVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(school_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_schools_owner ON schools(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status, created_at);
CREATE INDEX IF NOT EXISTS idx_school_members_user ON school_members(user_id, status);
