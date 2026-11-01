CREATE TABLE IF NOT EXISTS class_worksheets (
 id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
 deadline_at TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED')),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS class_worksheet_questions (
 id TEXT PRIMARY KEY, worksheet_id TEXT NOT NULL REFERENCES class_worksheets(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, skill TEXT NOT NULL, topic TEXT NOT NULL, question TEXT NOT NULL, reference_answer TEXT NOT NULL,
 UNIQUE(worksheet_id,position)
);
CREATE TABLE IF NOT EXISTS class_worksheet_guard (
 worksheet_id TEXT PRIMARY KEY REFERENCES class_worksheets(id) ON DELETE CASCADE,
 expected INTEGER NOT NULL CHECK(expected BETWEEN 1 AND 20), actual INTEGER NOT NULL CHECK(actual=expected)
);
CREATE TABLE IF NOT EXISTS class_worksheet_versions (
 id TEXT PRIMARY KEY, worksheet_id TEXT NOT NULL REFERENCES class_worksheets(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 10),
 answers_json TEXT NOT NULL, feedback_json TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(state IN ('SUBMITTED','RETURNED')),
 created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT REFERENCES users(id),
 UNIQUE(worksheet_id,student_id,version)
);
CREATE INDEX IF NOT EXISTS idx_worksheet_class ON class_worksheets(classroom_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worksheet_versions ON class_worksheet_versions(worksheet_id,student_id,version DESC);
