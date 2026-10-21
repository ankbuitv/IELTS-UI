-- 0030. Linked sign-in providers ("Connect Google/Microsoft to this account").
--
-- One row per (provider, subject): the provider's stable subject id. Resolution
-- order at sign-in is identity first, then email match (which also back-fills a
-- row here so the link survives an email change on either side).
CREATE TABLE user_identities (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider   TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, subject)
);

CREATE INDEX idx_user_identities_user ON user_identities (user_id);
