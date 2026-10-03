-- =============================================================================
-- Learn catalogue: lessons move out of the client bundle and into the database.
--
-- Until now the learning path was static content compiled into the browser
-- bundle (`src/shared/learn-content.ts`), so the path was frozen at four units
-- of four lessons and adding a lesson meant shipping a new Worker. The path is
-- growing to nine half bands (4.0 to 8.0) of many lessons each, and an
-- administrator must be able to generate and publish lessons at any band
-- without a deploy, so lessons are now rows.
--
-- `src/shared/learn-content.ts` survives as the SEED: the first time the
-- catalogue is read on an empty table it is inserted from there, so a fresh
-- database has a working path with no manual seeding step.
--
--   * `band` is a half band on the 4.0–8.0 ladder, never a value between rungs.
--   * `position` orders lessons inside a band; unlocking follows it.
--   * `payload_json` holds the lesson body (for `kind = 'VOCAB'`, the words), so
--     a later kind can be added without another table rewrite.
--   * `origin` records whether a lesson shipped with the product or was
--     generated, and `owner_id` scopes a personal lesson to one learner. It
--     never names a model.
--   * `status` lets a generated lesson be held as a draft before it is
--     published to learners.
--
-- `learn_profiles` gains `band_source` so a band the learner picked can be told
-- apart from one estimated from their tests: `start_band` alone could not carry
-- both meanings now that either can be any half band.
-- =============================================================================

CREATE TABLE learn_lessons (
  id           TEXT PRIMARY KEY,
  band         REAL NOT NULL,
  unit_key     TEXT NOT NULL,
  unit_title   TEXT NOT NULL DEFAULT '',
  unit_blurb   TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  blurb        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'VOCAB' CHECK (kind IN ('VOCAB')),
  payload_json TEXT NOT NULL,
  origin       TEXT NOT NULL DEFAULT 'BUILT_IN'
               CHECK (origin IN ('BUILT_IN', 'ADMIN_AI', 'PERSONAL_AI')),
  status       TEXT NOT NULL DEFAULT 'PUBLISHED'
               CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  owner_id     TEXT REFERENCES users (id) ON DELETE CASCADE,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One catalogue per band, in path order.
CREATE INDEX idx_learn_lessons_band ON learn_lessons (band, status, position);
-- A learner's own generated lessons (personal revision lessons), when added.
CREATE INDEX idx_learn_lessons_owner ON learn_lessons (owner_id, band);

ALTER TABLE learn_profiles ADD COLUMN band_source TEXT NOT NULL DEFAULT '';
