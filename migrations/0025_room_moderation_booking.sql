-- 0025: call-room moderation (kick / ban) and booking confirmation.
--
-- mentor_room_bans keeps a banned user out of one room session (class room or
-- 1:1). mentor_sessions gains a confirmation state so a booking request waits
-- for the mentor instead of being auto-confirmed.

CREATE TABLE IF NOT EXISTS mentor_room_bans (
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  banned_by  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- Sessions created before confirmation existed are already underway: mark them
-- confirmed so nothing becomes unbookable after the deploy.
UPDATE mentor_sessions SET status = 'CONFIRMED' WHERE status = 'PENDING';
