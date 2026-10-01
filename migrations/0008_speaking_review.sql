-- =============================================================================
-- Speaking review queue.
--
-- The AI grader writes a band into `speaking_sessions.overall_band`; a teacher
-- can overrule it. Recording who produced the band (and with which model) makes
-- the difference between an AI estimate and a human judgement visible in the
-- result screen, which is the rule the Writing side already follows with
-- `writing_scores.scoring_source`.
-- =============================================================================

ALTER TABLE speaking_sessions ADD COLUMN score_source TEXT;
ALTER TABLE speaking_sessions ADD COLUMN scored_by TEXT REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE speaking_sessions ADD COLUMN scored_at TEXT;

CREATE INDEX idx_speaking_sessions_status ON speaking_sessions (status, created_at DESC);
