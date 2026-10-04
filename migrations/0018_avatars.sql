-- =============================================================================
-- Avatars.
--
-- Every screen that names a learner — the top bar, the profile page, the
-- leaderboards — drew two initials in a coloured circle. That is fine, and it
-- stays the fallback, but a picture is what makes a board feel like people.
--
-- Two kinds of avatar are stored, and they are stored differently on purpose:
--
--   * `avatar_kind = 'PRESET'` picks one of the mascot coats the client already
--     draws (`avatar_preset` holds the coat name). It costs nothing, cannot be
--     invalid, and — because it is a short string — it is cheap enough to send
--     down with every leaderboard row, so a board full of preset avatars is a
--     board full of colour rather than fifty identical circles.
--   * `avatar_kind = 'UPLOAD'` is a file the learner chose. The bytes live in
--     `avatar_blobs`, chunked exactly like `asset_blobs` and
--     `speaking_recording_blobs`, because V1 has no object storage. The upload
--     is validated twice — once by the filename and declared type, once by the
--     file's own magic bytes — in `src/worker/services/avatar-service.ts`; this
--     table only stores what survived.
--
-- `avatar_mime`, `avatar_bytes`, `avatar_name` and `avatar_updated_at` are kept
-- beside the blob so the profile page can describe the picture ("photo.png,
-- 48 KB, changed yesterday") without reading it, and so an over-quota account
-- can be found with one query.
-- =============================================================================

ALTER TABLE user_profiles ADD COLUMN avatar_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN avatar_preset TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN avatar_mime TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN avatar_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN avatar_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN avatar_updated_at TEXT;

CREATE TABLE avatar_blobs (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'image/png',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, chunk_index)
);
CREATE INDEX idx_avatar_blobs_user ON avatar_blobs (user_id);
