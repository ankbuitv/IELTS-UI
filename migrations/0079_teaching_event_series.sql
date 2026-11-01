ALTER TABLE classroom_teaching_events ADD COLUMN series_id TEXT;
ALTER TABLE classroom_teaching_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'REGULAR' CHECK (kind IN ('REGULAR','MAKEUP'));
ALTER TABLE classroom_teaching_events ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_class_teaching_series ON classroom_teaching_events(classroom_id,series_id);
