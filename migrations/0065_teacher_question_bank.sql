CREATE TABLE IF NOT EXISTS teacher_question_bank (
 id TEXT PRIMARY KEY,
 author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 skill TEXT NOT NULL CHECK(skill IN ('LISTENING','READING','WRITING','SPEAKING')),
 topic TEXT NOT NULL,
 question TEXT NOT NULL,
 reference_answer TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teacher_question_bank ON teacher_question_bank(author_id,updated_at DESC);
