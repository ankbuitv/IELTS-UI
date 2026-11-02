ALTER TABLE teacher_question_bank ADD COLUMN question_type TEXT NOT NULL DEFAULT 'TEXT' CHECK(question_type IN ('TEXT','MULTIPLE_CHOICE'));
ALTER TABLE teacher_question_bank ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE teacher_question_bank ADD COLUMN correct_index INTEGER;
