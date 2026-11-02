ALTER TABLE teacher_resources ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'NORMAL' CHECK(sensitivity IN ('NORMAL','SENSITIVE'));
