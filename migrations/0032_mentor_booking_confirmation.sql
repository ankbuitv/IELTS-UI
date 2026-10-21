-- Booking confirmation state.
--
-- 0025 introduced the "mentor confirms a request" flow but the table's CHECK
-- constraint never learned the REQUESTED status, so every one-to-one booking
-- failed with a constraint error. Rebuilding a table that other tables
-- reference (room bans, messages, signals) is risky on D1, so the confirmation
-- state lives in its own column and the lifecycle stays in `status`:
--
--   new booking      status SCHEDULED, confirmation REQUESTED
--   mentor confirms  confirmation CONFIRMED (status stays SCHEDULED)
--   either declines  status CANCELLED,  confirmation DECLINED
--
-- A pending booking still occupies its slot (the clash check looks at
-- SCHEDULED), which is what both sides expect.

ALTER TABLE mentor_sessions ADD COLUMN confirmation TEXT NOT NULL DEFAULT 'CONFIRMED'
  CHECK (confirmation IN ('REQUESTED', 'CONFIRMED', 'DECLINED', 'NONE'));

CREATE INDEX IF NOT EXISTS idx_mentor_sessions_confirmation
  ON mentor_sessions (confirmation, status, starts_at);
