-- =============================================================================
-- Profile avatars + class chat.
--
-- 1. `user_profiles` learns when an avatar was last set (`avatar_updated_at`,
--    used as a cache-buster in `/api/files/avatar/:userId?v=…`) and its MIME.
-- 2. `profile_avatars` stores the picture itself as chunked base64 in D1 (the
--    same pattern as `speaking_recording_blobs` — V1 has no object storage).
-- 3. `mentor_class_messages` is the group chat inside a mentor-led class: one
--    feed shared by every member, kept after the live call ends.
-- =============================================================================

ALTER TABLE user_profiles ADD COLUMN avatar_updated_at TEXT;
ALTER TABLE user_profiles ADD COLUMN avatar_mime TEXT;

CREATE TABLE IF NOT EXISTS profile_avatars (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'image/png',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS mentor_class_messages (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES mentor_classes (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentor_class_messages_class ON mentor_class_messages (class_id, created_at);
