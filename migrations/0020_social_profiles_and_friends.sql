-- Public learning profiles, earned-profile cosmetics, and student friendships.
-- Profile artwork is selected from original in-app creature/theme presets; no
-- uploaded images or personal contact details are exposed on public profiles.
ALTER TABLE user_profiles ADD COLUMN avatar_key TEXT NOT NULL DEFAULT 'bo';
ALTER TABLE user_profiles ADD COLUMN banner_key TEXT NOT NULL DEFAULT 'default';
ALTER TABLE user_profiles ADD COLUMN username_color TEXT NOT NULL DEFAULT 'default';
ALTER TABLE user_profiles ADD COLUMN profile_effect TEXT NOT NULL DEFAULT 'none';

CREATE TABLE friend_requests (
  id           TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (requester_id <> recipient_id),
  UNIQUE (requester_id, recipient_id)
);
CREATE INDEX idx_friend_requests_recipient ON friend_requests (recipient_id, status, created_at);
CREATE INDEX idx_friend_requests_requester ON friend_requests (requester_id, status, created_at);
