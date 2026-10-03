-- An optional teaching video (YouTube or any embeddable URL) on a lesson.
ALTER TABLE learn_lessons ADD COLUMN video_url TEXT NOT NULL DEFAULT '';
