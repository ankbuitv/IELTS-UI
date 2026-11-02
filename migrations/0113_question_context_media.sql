ALTER TABLE teacher_question_bank ADD COLUMN context_text TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS teacher_question_media (
 question_id TEXT NOT NULL REFERENCES teacher_question_bank(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('IMAGE','AUDIO')),mime TEXT NOT NULL,data_b64 TEXT NOT NULL,
 start_seconds INTEGER NOT NULL DEFAULT 0 CHECK(start_seconds BETWEEN 0 AND 86400),PRIMARY KEY(question_id,kind)
);
CREATE TABLE IF NOT EXISTS worksheet_question_media (
 question_id TEXT NOT NULL REFERENCES class_worksheet_questions(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('IMAGE','AUDIO')),mime TEXT NOT NULL,data_b64 TEXT NOT NULL,
 start_seconds INTEGER NOT NULL DEFAULT 0 CHECK(start_seconds BETWEEN 0 AND 86400),PRIMARY KEY(question_id,kind)
);
