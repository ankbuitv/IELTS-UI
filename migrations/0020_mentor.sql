-- =============================================================================
-- Mentor platform.
--
-- Mentors are their own account type (`users.role = 'MENTOR'`): a mentor coaches
-- students one on one and leads small live classes, with bookable slots, a call
-- room (video/audio + chat + notes) per session, and reviews after the fact.
--
-- This migration:
--   1. rebuilds `users` so the role CHECK accepts 'MENTOR' (SQLite cannot alter
--      a CHECK in place — same technique as migration 0003 for `assets`);
--   2. adds the mentor tables: profiles, weekly availability, sessions
--      (bookings / calls), group classes, class membership, room chat, WebRTC
--      signalling envelopes and reviews.
--
-- Foreign keys are deferred so the `users` rebuild is safe for every child table.
-- =============================================================================

PRAGMA defer_foreign_keys = ON;

-- ----------------------------------------------------------------------------- 1. users role CHECK
CREATE TABLE users_v2 (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  role                TEXT NOT NULL CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN', 'MENTOR')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INVITED')),
  password_algo       TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  password_hash       TEXT,
  password_salt       TEXT,
  password_iterations INTEGER,
  created_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  last_login_at       TEXT,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT
);

INSERT INTO users_v2 (id, email, role, status, password_algo, password_hash, password_salt,
                      password_iterations, created_by, created_at, updated_at, last_login_at,
                      failed_login_count, locked_until)
SELECT id, email, role, status, password_algo, password_hash, password_salt,
       password_iterations, created_by, created_at, updated_at, last_login_at,
       failed_login_count, locked_until
  FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

CREATE INDEX idx_users_role ON users (role);

-- ----------------------------------------------------------------------------- 2. mentor tables

CREATE TABLE mentor_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  headline          TEXT NOT NULL DEFAULT '',
  bio               TEXT NOT NULL DEFAULT '',
  specialties       TEXT NOT NULL DEFAULT '[]',   -- JSON array of MentorSpecialty
  languages         TEXT NOT NULL DEFAULT '[]',   -- JSON array of language names
  hourly_rate_coins INTEGER NOT NULL DEFAULT 0,
  years_experience  INTEGER NOT NULL DEFAULT 0,
  rating_avg        REAL NOT NULL DEFAULT 0,
  rating_count      INTEGER NOT NULL DEFAULT 0,
  students_count    INTEGER NOT NULL DEFAULT 0,
  sessions_count    INTEGER NOT NULL DEFAULT 0,
  verified          INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_mentor_profiles_active ON mentor_profiles (active, rating_avg DESC);

-- Weekly recurring availability windows (minutes of day, 0..1440).
CREATE TABLE mentor_availability (
  id           TEXT PRIMARY KEY,
  mentor_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute   INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at   TEXT NOT NULL,
  CHECK (start_minute < end_minute)
);
CREATE INDEX idx_mentor_availability_mentor ON mentor_availability (mentor_id, weekday);

-- Small live classes led by a mentor (the "club" format: many students, one
-- mentor, one room).
CREATE TABLE mentor_classes (
  id          TEXT PRIMARY KEY,
  mentor_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'All levels',
  capacity    INTEGER NOT NULL DEFAULT 10,
  price_coins INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'LIVE', 'COMPLETED', 'CANCELLED')),
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  recurrence  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_mentor_classes_mentor ON mentor_classes (mentor_id, starts_at);
CREATE INDEX idx_mentor_classes_status ON mentor_classes (status, starts_at);

-- One row per booked / held coaching session. A CLASS session belongs to a
-- mentor_classes row; a ONE_ON_ONE session is a direct booking.
CREATE TABLE mentor_sessions (
  id              TEXT PRIMARY KEY,
  mentor_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  class_id        TEXT REFERENCES mentor_classes (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'ONE_ON_ONE' CHECK (kind IN ('ONE_ON_ONE', 'CLASS')),
  status          TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  topic           TEXT NOT NULL DEFAULT '',
  notes           TEXT,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT,
  paid_coins      INTEGER NOT NULL DEFAULT 0,
  student_rating  INTEGER,
  mentor_feedback TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_mentor_sessions_mentor ON mentor_sessions (mentor_id, starts_at);
CREATE INDEX idx_mentor_sessions_student ON mentor_sessions (student_id, starts_at);
CREATE INDEX idx_mentor_sessions_status ON mentor_sessions (status, starts_at);

CREATE TABLE mentor_class_members (
  class_id   TEXT NOT NULL REFERENCES mentor_classes (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX idx_mentor_class_members_user ON mentor_class_members (user_id);

-- Room chat and structured notes for a session.
CREATE TABLE mentor_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'CHAT' CHECK (kind IN ('CHAT', 'SYSTEM', 'NOTE')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mentor_messages_session ON mentor_messages (session_id, created_at);

-- WebRTC signalling envelopes (SDP offer/answer, ICE candidates) relayed
-- through D1 so two browsers in the same room can find each other without a
-- dedicated realtime service.
CREATE TABLE mentor_signals (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id  TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('OFFER', 'ANSWER', 'CANDIDATE', 'BYE')),
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mentor_signals_session ON mentor_signals (session_id, created_at);

CREATE TABLE mentor_reviews (
  id         TEXT PRIMARY KEY,
  mentor_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES mentor_sessions (id) ON DELETE SET NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mentor_reviews_mentor ON mentor_reviews (mentor_id, created_at DESC);

-- Presence inside a live room (who is in the call right now, hand raised).
CREATE TABLE mentor_room_presence (
  session_id  TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hand_raised INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id)
);
