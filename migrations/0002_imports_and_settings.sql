-- =============================================================================
-- Additions: extracted-text storage for imports and platform settings
-- =============================================================================

ALTER TABLE imports ADD COLUMN extracted_r2_key TEXT;
ALTER TABLE imports ADD COLUMN structured_payload_json TEXT;
ALTER TABLE imports ADD COLUMN answer_key_confidence TEXT
  CHECK (answer_key_confidence IN ('PROVIDED', 'PARTIAL', 'ABSENT'));

-- Simple key/value store for platform-wide settings editable in the admin UI.
CREATE TABLE platform_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO platform_settings (key, value_json, updated_at) VALUES
  ('band_estimation_enabled', 'true', '2026-01-01T00:00:00.000Z'),
  ('ai_import_enabled', 'true', '2026-01-01T00:00:00.000Z'),
  ('registration_enabled', 'true', '2026-01-01T00:00:00.000Z'),
  ('integrity_notice', '"Observable browser events are recorded during exam-mode attempts. The platform cannot block operating-system actions such as Alt+Tab."', '2026-01-01T00:00:00.000Z');
