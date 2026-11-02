CREATE TABLE IF NOT EXISTS class_assignment_questions (
 id TEXT PRIMARY KEY, classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ANSWERED','RESOLVED')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_assignment_questions ON class_assignment_questions(classroom_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS class_assignment_answers (
 id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES class_assignment_questions(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_assignment_answers ON class_assignment_answers(question_id,created_at,id);
