ALTER TABLE class_worksheets ADD COLUMN shuffle_questions INTEGER NOT NULL DEFAULT 0 CHECK(shuffle_questions IN (0,1));
ALTER TABLE class_worksheets ADD COLUMN shuffle_options INTEGER NOT NULL DEFAULT 0 CHECK(shuffle_options IN (0,1));
CREATE TABLE IF NOT EXISTS worksheet_question_mcq (
 question_id TEXT PRIMARY KEY REFERENCES class_worksheet_questions(id) ON DELETE CASCADE,
 options_json TEXT NOT NULL,correct_index INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS worksheet_mcq_scores (
 version_id TEXT PRIMARY KEY REFERENCES class_worksheet_versions(id) ON DELETE CASCADE,
 total INTEGER NOT NULL,answered INTEGER NOT NULL,correct INTEGER NOT NULL
);
