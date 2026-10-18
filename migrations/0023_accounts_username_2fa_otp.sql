-- Accounts: human usernames + second-factor material.
--   * users.username — public handle (unique), also usable to sign in.
--   * user_profiles.totp_secret / totp_enabled — authenticator-app 2FA.
--   * login_otp_codes — one-time codes (email login without a password, and
--     2FA backup codes): hashed, single-use, short-lived.

ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)
  WHERE username IS NOT NULL;

ALTER TABLE user_profiles ADD COLUMN totp_secret TEXT;
ALTER TABLE user_profiles ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS login_otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('LOGIN', 'BACKUP')),
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  code_iterations INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_otp_user ON login_otp_codes (user_id, purpose, used_at);
