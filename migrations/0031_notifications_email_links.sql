-- Notification centre, transactional email outbox and passwordless auth links.
--
--   * notifications   — in-app bell. One row per user per event; `read_at`
--                       holds the moment it was opened.
--   * email_outbox    — every transactional email is recorded here first, so
--                       the flow is testable and debuggable even when no email
--                       provider is configured (status QUEUED) and production
--                       sends are auditable (SENT / FAILED + provider error).
--   * auth_links      — single-use hashed tokens for magic-link sign-in and
--                       password reset. The plaintext token only exists in the
--                       email; the database keeps a SHA-256 hash.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  provider TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_to ON email_outbox (to_email, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('MAGIC', 'RESET')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_links_user
  ON auth_links (user_id, purpose, used_at, created_at DESC);
