-- Learn identity, friend links and private daily lesson sets.
-- Online status is derived from the existing session heartbeat; no new tracking
-- table or precise location data is introduced.

ALTER TABLE user_profiles ADD COLUMN avatar_id TEXT NOT NULL DEFAULT 'bo';
ALTER TABLE user_profiles ADD COLUMN name_effect TEXT NOT NULL DEFAULT 'default';
ALTER TABLE user_profiles ADD COLUMN profile_effect TEXT NOT NULL DEFAULT 'none';

CREATE TABLE friendships (
  user_low_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by = user_low_id OR requested_by = user_high_id)
);
CREATE INDEX idx_friendships_requested_by ON friendships (requested_by, status, updated_at);

CREATE TABLE learn_daily_lessons (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  band       REAL NOT NULL,
  slot       INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 5),
  lesson_id  TEXT NOT NULL REFERENCES learn_lessons (id) ON DELETE CASCADE,
  quote      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, band, slot),
  UNIQUE (user_id, day, band, lesson_id)
);
CREATE INDEX idx_learn_daily_lessons_user_day ON learn_daily_lessons (user_id, day, band, slot);
