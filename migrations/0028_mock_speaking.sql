-- 0028: speaking as part of the official full mock.
--
-- Submitting a full mock opens one linked speaking session (AI-judged like
-- Writing). The link lets the result page show the speaking band as part of
-- the mock instead of as unrelated practice.

ALTER TABLE speaking_sessions ADD COLUMN source_attempt_id TEXT;

CREATE INDEX IF NOT EXISTS idx_speaking_sessions_attempt
  ON speaking_sessions (source_attempt_id);
