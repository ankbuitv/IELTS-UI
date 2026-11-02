-- Weekly availability is private to the teacher; it does not create bookings.
CREATE TABLE IF NOT EXISTS teacher_weekly_availability (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
