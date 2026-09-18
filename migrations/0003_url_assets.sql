-- =============================================================================
-- V1 has no object storage. Media (listening audio, chart/diagram images) is
-- referenced by external HTTPS URL, and the small built-in demo assets ship
-- with the application bundle.
--
-- This migration therefore rebuilds `assets` around that model:
--   * `storage_kind` = 'EXTERNAL_URL' (default) | 'BUNDLED' | 'OBJECT_STORAGE'
--   * `external_url` holds the HTTPS URL for EXTERNAL_URL assets
--   * `r2_key` becomes optional and unused in V1; it is kept only so a future
--     object-storage adapter can be added without another table rewrite.
--
-- `imports` gains `source_text`: uploaded/pasted text is processed during the
-- request and the extracted text is kept in D1. Original binary uploads are not
-- retained in V1 (see the import screen), which is why no blob storage is
-- required.
--
-- Foreign keys are deferred so the table rebuild is safe for existing rows that
-- are referenced by `sections.audio_asset_id` and `tests.source_asset_id`.
-- =============================================================================

PRAGMA defer_foreign_keys = ON;

CREATE TABLE assets_v2 (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('PDF', 'DOC', 'IMAGE', 'AUDIO', 'OTHER')),
  storage_kind     TEXT NOT NULL DEFAULT 'EXTERNAL_URL'
                   CHECK (storage_kind IN ('EXTERNAL_URL', 'BUNDLED', 'OBJECT_STORAGE')),
  external_url     TEXT,
  r2_key           TEXT UNIQUE,
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  checksum_sha256  TEXT,
  duration_seconds REAL,
  width            INTEGER,
  height           INTEGER,
  alt_text         TEXT,
  visibility       TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'ATTEMPT')),
  test_version_id  TEXT REFERENCES test_versions (id) ON DELETE SET NULL,
  uploaded_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  -- An EXTERNAL_URL asset must carry a URL; a bundled/object-storage asset need not.
  CHECK (storage_kind <> 'EXTERNAL_URL' OR external_url IS NOT NULL)
);

INSERT INTO assets_v2 (id, kind, storage_kind, external_url, r2_key, filename, mime, size_bytes,
                       checksum_sha256, duration_seconds, width, height, alt_text, visibility,
                       test_version_id, uploaded_by, created_at, updated_at)
SELECT id, kind,
       CASE WHEN r2_key IS NULL THEN 'EXTERNAL_URL' ELSE 'OBJECT_STORAGE' END,
       NULL, r2_key, filename, mime, size_bytes, checksum_sha256, duration_seconds, width, height,
       alt_text, visibility, test_version_id, uploaded_by, created_at, created_at
  FROM assets;

DROP TABLE assets;
ALTER TABLE assets_v2 RENAME TO assets;

CREATE INDEX idx_assets_version ON assets (test_version_id);
CREATE INDEX idx_assets_kind ON assets (kind, created_at);

PRAGMA defer_foreign_keys = OFF;

ALTER TABLE imports ADD COLUMN source_text TEXT;
