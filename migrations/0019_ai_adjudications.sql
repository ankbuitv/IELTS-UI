CREATE TABLE IF NOT EXISTS ai_adjudications (
  entity_type        TEXT NOT NULL CHECK (entity_type IN ('WRITING', 'SPEAKING')),
  entity_id          TEXT NOT NULL,
  band               REAL,
  criteria_json      TEXT NOT NULL DEFAULT '[]',
  rationale          TEXT NOT NULL DEFAULT '',
  criterion_keys_json TEXT NOT NULL DEFAULT '[]',
  overall_reviewed   INTEGER NOT NULL DEFAULT 0 CHECK (overall_reviewed IN (0, 1)),
  created_at         TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_adjudications_entity ON ai_adjudications (entity_type, entity_id);
