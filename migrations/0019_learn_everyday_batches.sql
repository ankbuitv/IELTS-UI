CREATE TABLE IF NOT EXISTS learn_daily_lesson_batches (
  band        REAL NOT NULL,
  day         TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('GENERATING', 'READY', 'FAILED')),
  lesson_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (band, day)
);
CREATE INDEX IF NOT EXISTS idx_learn_daily_batches_day ON learn_daily_lesson_batches (day, status);
