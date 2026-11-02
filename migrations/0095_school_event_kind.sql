-- Explicitly distinguish manually maintained school holidays and leave periods.
ALTER TABLE school_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'EVENT' CHECK (kind IN ('EVENT','HOLIDAY','LEAVE'));
