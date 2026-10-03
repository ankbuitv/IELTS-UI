-- A legendary lesson is a harder, upgraded variant unlocked by reaching its band in practice.
ALTER TABLE learn_lessons ADD COLUMN legendary INTEGER NOT NULL DEFAULT 0;
