CREATE TABLE IF NOT EXISTS school_terms (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ARCHIVED')),
 snapshot_json TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, archived_at TEXT,
 CHECK(starts_on<=ends_on)
);
CREATE INDEX IF NOT EXISTS idx_school_terms_school ON school_terms(school_id,starts_on DESC);
CREATE TABLE IF NOT EXISTS school_term_allocations (
 id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES school_terms(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 UNIQUE(term_id,classroom_id,teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_school_term_teacher ON school_term_allocations(teacher_id,term_id);
