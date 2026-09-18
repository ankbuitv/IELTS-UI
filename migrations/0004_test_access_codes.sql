-- =============================================================================
-- Test access codes: an optional per-test code that students must enter once
-- before they can self-start practice attempts. Codes are stored as
-- PBKDF2-SHA256 hashes (never plaintext); successful entry records a
-- permanent unlock row so the code is only needed once per student per test.
-- =============================================================================

ALTER TABLE tests ADD COLUMN access_code_hash TEXT;
ALTER TABLE tests ADD COLUMN access_code_salt TEXT;
ALTER TABLE tests ADD COLUMN access_code_iterations INTEGER;
ALTER TABLE tests ADD COLUMN access_code_set_at TEXT;
ALTER TABLE tests ADD COLUMN access_code_set_by TEXT REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE test_unlocks (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  test_id     TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, test_id)
);
CREATE INDEX idx_test_unlocks_test ON test_unlocks (test_id);
