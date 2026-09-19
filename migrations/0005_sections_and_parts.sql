-- =============================================================================
-- 28/29. Sections / Parts as a first-class data model.
--
-- Sections become explicitly typed, labelled, ordered structures that own:
--   * a normalised `type`  (READING_PASSAGE | LISTENING_PART | WRITING_TASK)
--     so "Part 1" is structural meaning, never presentation-only text,
--   * a short display `label` ("Passage 1", "Part 2", "Task 1"),
--   * `description` (candidate-facing summary line under the label),
--   * `transcript_json` — listening transcripts, segment-based,
--   * `image_asset_id` — optional diagram/chart media for the section.
--
-- Ordering stays explicit and persisted in `sections.order_index` (existing).
--
-- 38/39. Per-section attempt state: `attempt_sections` snapshots the section
-- structure an attempt runs against and tracks timing + progress server-side,
-- so progress never relies exclusively on client state and historical attempts
-- keep the section structure of their original version (40).
-- =============================================================================

ALTER TABLE sections ADD COLUMN type TEXT
  CHECK (type IS NULL OR type IN ('READING_PASSAGE', 'LISTENING_PART', 'WRITING_TASK'));
ALTER TABLE sections ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE sections ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE sections ADD COLUMN transcript_json TEXT;   -- NULL | [{ id, startSeconds, speaker, text }]
ALTER TABLE sections ADD COLUMN image_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL;
CREATE INDEX idx_sections_image ON sections (image_asset_id);

-- Server-authoritative per-section attempt state -------------------------------
CREATE TABLE attempt_sections (
  id              TEXT PRIMARY KEY,
  attempt_id      TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  section_id      TEXT NOT NULL,
  section_order   INTEGER NOT NULL,
  skill           TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
  label           TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER,
  -- Section timing is only enforced when the version's policy enables it;
  -- NULL deadlines mean "not started yet" or "no per-section timer".
  status          TEXT NOT NULL DEFAULT 'NOT_STARTED'
                  CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED')),
  started_at      TEXT,
  deadline_at     TEXT,
  submitted_at    TEXT,
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_count  INTEGER NOT NULL DEFAULT 0,
  flagged_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (attempt_id, section_id)
);
CREATE INDEX idx_attempt_sections_attempt ON attempt_sections (attempt_id, section_order);
