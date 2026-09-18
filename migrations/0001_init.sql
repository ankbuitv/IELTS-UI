-- =============================================================================
-- IELTS-style platform - initial schema (D1 / SQLite)
-- All timestamps are ISO-8601 UTC strings produced by new Date().toISOString()
-- so they are lexicographically sortable and timezone unambiguous.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity, sessions, profiles
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,          -- stored lower-cased
  role                TEXT NOT NULL CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INVITED')),
  password_algo       TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  password_hash       TEXT,                          -- base64url, never leaves the server
  password_salt       TEXT,
  password_iterations INTEGER,
  created_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  last_login_at       TEXT,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT
);
CREATE INDEX idx_users_role ON users (role);

CREATE TABLE user_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  target_band  REAL,
  timezone     TEXT,
  locale       TEXT NOT NULL DEFAULT 'en',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                      -- SHA-256(HMAC(pepper, token)) hex
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at  TEXT,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Used for rate limiting (login, AI endpoints) and login throttling.
CREATE TABLE rate_limit_counters (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,                     -- epoch seconds, floor(now / window)
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE login_attempts (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  ip         TEXT,
  success    INTEGER NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, created_at);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip, created_at);

-- -----------------------------------------------------------------------------
-- Classrooms
-- -----------------------------------------------------------------------------
CREATE TABLE classrooms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  teacher_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  join_code   TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_classrooms_teacher ON classrooms (teacher_id);

CREATE TABLE classroom_members (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'CO_TEACHER')),
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REMOVED')),
  invited_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  joined_at    TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (classroom_id, user_id)
);
CREATE INDEX idx_classroom_members_user ON classroom_members (user_id);
CREATE INDEX idx_classroom_members_classroom ON classroom_members (classroom_id);

CREATE TABLE classroom_invites (
  id                 TEXT PRIMARY KEY,
  classroom_id       TEXT NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  email              TEXT,                            -- null = open join code
  token_hash         TEXT NOT NULL UNIQUE,
  invited_by         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  accepted_at        TEXT,
  accepted_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  revoked_at         TEXT
);
CREATE INDEX idx_classroom_invites_classroom ON classroom_invites (classroom_id);
CREATE INDEX idx_classroom_invites_email ON classroom_invites (email);

-- -----------------------------------------------------------------------------
-- Assets (metadata in D1; V1 links external HTTPS URLs — see migration 0003)
-- -----------------------------------------------------------------------------
CREATE TABLE assets (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('PDF', 'DOC', 'IMAGE', 'AUDIO', 'OTHER')),
  r2_key           TEXT NOT NULL UNIQUE,
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
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_assets_version ON assets (test_version_id);

-- -----------------------------------------------------------------------------
-- Content: tests, immutable versions, sections, passages, questions
-- -----------------------------------------------------------------------------
CREATE TABLE tests (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('READING', 'LISTENING', 'WRITING', 'FULL_MOCK')),
  status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  summary            TEXT NOT NULL DEFAULT '',
  current_version_id TEXT,
  created_by         TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  archived_at        TEXT,
  -- content provenance (copyright tracking)
  content_origin     TEXT NOT NULL DEFAULT 'ORIGINAL'
                     CHECK (content_origin IN ('ORIGINAL', 'LICENSED', 'AI_GENERATED', 'IMPORTED', 'OFFICIAL_PROVIDER')),
  source_title       TEXT,
  source_url         TEXT,
  attribution        TEXT,
  license_notes      TEXT,
  source_asset_id    TEXT
);
CREATE INDEX idx_tests_type_status ON tests (type, status);

CREATE TABLE test_versions (
  id                  TEXT PRIMARY KEY,
  test_id             TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')),
  change_note         TEXT NOT NULL DEFAULT '',
  config_json         TEXT NOT NULL DEFAULT '{}',    -- timing / integrity / display defaults
  total_questions     INTEGER NOT NULL DEFAULT 0,
  duration_seconds    INTEGER,
  is_complete_test    INTEGER NOT NULL DEFAULT 0,    -- eligible for band estimation
  scoring_profile_id  TEXT REFERENCES scoring_profiles (id) ON DELETE SET NULL,
  created_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  published_at        TEXT,
  published_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  archived_at         TEXT,
  frozen_snapshot_json TEXT,                          -- canonical snapshot captured at publish
  validation_json     TEXT,                           -- last deterministic validation report
  UNIQUE (test_id, version_number)
);
CREATE INDEX idx_test_versions_test ON test_versions (test_id);
CREATE INDEX idx_test_versions_status ON test_versions (status);

CREATE TABLE passages (
  id              TEXT PRIMARY KEY,
  test_version_id TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  order_index     INTEGER NOT NULL DEFAULT 0,
  title           TEXT NOT NULL DEFAULT '',
  subtitle        TEXT,
  body_json       TEXT NOT NULL DEFAULT '[]',        -- [{ "label": "A", "text": "..." }]
  word_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_passages_version ON passages (test_version_id);

CREATE TABLE sections (
  id               TEXT PRIMARY KEY,
  test_version_id  TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  skill            TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
  order_index      INTEGER NOT NULL DEFAULT 0,
  title            TEXT NOT NULL DEFAULT '',
  subtitle         TEXT,
  instructions     TEXT NOT NULL DEFAULT '',
  passage_id       TEXT REFERENCES passages (id) ON DELETE SET NULL,
  audio_asset_id   TEXT REFERENCES assets (id) ON DELETE SET NULL,
  duration_seconds INTEGER,
  config_json      TEXT NOT NULL DEFAULT '{}',        -- playback policy, etc.
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_sections_version ON sections (test_version_id);

CREATE TABLE question_groups (
  id                  TEXT PRIMARY KEY,
  test_version_id     TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  section_id          TEXT NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  order_index         INTEGER NOT NULL DEFAULT 0,
  question_type       TEXT NOT NULL,
  instructions        TEXT NOT NULL DEFAULT '',
  shared_options_json TEXT NOT NULL DEFAULT '[]',     -- heading / option bank shared by the group
  config_json         TEXT NOT NULL DEFAULT '{}',     -- wordLimit, selectCount, taskLabel...
  range_from          INTEGER,
  range_to            INTEGER,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_question_groups_section ON question_groups (section_id);
CREATE INDEX idx_question_groups_version ON question_groups (test_version_id);

CREATE TABLE questions (
  id                  TEXT PRIMARY KEY,
  test_version_id     TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  section_id          TEXT NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  question_group_id   TEXT NOT NULL REFERENCES question_groups (id) ON DELETE CASCADE,
  number              INTEGER NOT NULL,
  order_index         INTEGER NOT NULL DEFAULT 0,
  prompt              TEXT NOT NULL DEFAULT '',
  body_json           TEXT NOT NULL DEFAULT '{}',     -- candidate-visible context (summary/note blocks)
  options_json        TEXT NOT NULL DEFAULT '[]',     -- per-question options (rare; groups usually hold them)
  config_json         TEXT NOT NULL DEFAULT '{}',     -- wordLimit, maxWords, etc.
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (test_version_id, number)
);
CREATE INDEX idx_questions_section ON questions (section_id);
CREATE INDEX idx_questions_group ON questions (question_group_id);
CREATE INDEX idx_questions_version ON questions (test_version_id);

-- PROTECTED: never selected into any candidate-facing payload.
CREATE TABLE answer_keys (
  id              TEXT PRIMARY KEY,
  question_id     TEXT NOT NULL UNIQUE REFERENCES questions (id) ON DELETE CASCADE,
  test_version_id TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  answer_json     TEXT NOT NULL,                      -- structured, see src/shared/answer-key.ts
  evidence        TEXT,                               -- where the answer is found in the source
  explanation     TEXT,
  updated_by      TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_answer_keys_version ON answer_keys (test_version_id);

-- -----------------------------------------------------------------------------
-- Scoring profiles (band conversion) - versioned, never mutated in place
-- -----------------------------------------------------------------------------
CREATE TABLE scoring_profiles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  skill         TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
  test_type     TEXT NOT NULL CHECK (test_type IN ('READING', 'LISTENING', 'WRITING', 'FULL_MOCK')),
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  min_questions INTEGER NOT NULL DEFAULT 40,
  source_notes  TEXT NOT NULL DEFAULT '',
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE score_conversion_ranges (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES scoring_profiles (id) ON DELETE CASCADE,
  raw_min     INTEGER NOT NULL,
  raw_max     INTEGER NOT NULL,
  band        REAL NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_conversion_profile ON score_conversion_ranges (profile_id);

-- -----------------------------------------------------------------------------
-- Full mock composition (a FULL_MOCK version references published skill versions)
-- -----------------------------------------------------------------------------
CREATE TABLE mock_components (
  id                  TEXT PRIMARY KEY,
  mock_version_id     TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
  order_index         INTEGER NOT NULL DEFAULT 0,
  skill               TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
  test_version_id     TEXT NOT NULL REFERENCES test_versions (id),
  label               TEXT NOT NULL DEFAULT '',
  duration_seconds    INTEGER NOT NULL,
  break_after_seconds INTEGER NOT NULL DEFAULT 0,
  config_json         TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_mock_components_version ON mock_components (mock_version_id);

-- -----------------------------------------------------------------------------
-- Assignments
-- -----------------------------------------------------------------------------
CREATE TABLE assignments (
  id                    TEXT PRIMARY KEY,
  classroom_id          TEXT NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  teacher_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  test_id               TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  test_version_id       TEXT NOT NULL REFERENCES test_versions (id),
  title                 TEXT NOT NULL,
  instructions          TEXT NOT NULL DEFAULT '',
  start_at              TEXT,
  deadline_at           TEXT,
  max_attempts          INTEGER NOT NULL DEFAULT 1,
  timing_policy         TEXT NOT NULL DEFAULT 'EXAM_DURATION'
                        CHECK (timing_policy IN ('EXAM_DURATION', 'UNTIMED', 'CUSTOM')),
  custom_duration_seconds INTEGER,
  mode                  TEXT NOT NULL DEFAULT 'STANDARD_EXAM'
                        CHECK (mode IN ('PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM')),
  integrity_policy_json TEXT NOT NULL DEFAULT '{}',
  result_visibility     TEXT NOT NULL DEFAULT 'AFTER_DEADLINE'
                        CHECK (result_visibility IN ('IMMEDIATE', 'AFTER_DEADLINE', 'SCORE_ONLY', 'NO_REVIEW')),
  allow_reattempt       INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_assignments_classroom ON assignments (classroom_id);
CREATE INDEX idx_assignments_teacher ON assignments (teacher_id);
CREATE INDEX idx_assignments_version ON assignments (test_version_id);

-- -----------------------------------------------------------------------------
-- Attempts (server-authoritative exam state)
-- -----------------------------------------------------------------------------
CREATE TABLE attempts (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignment_id         TEXT REFERENCES assignments (id) ON DELETE SET NULL,
  test_id               TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  test_version_id       TEXT NOT NULL REFERENCES test_versions (id),
  test_type             TEXT NOT NULL CHECK (test_type IN ('READING', 'LISTENING', 'WRITING', 'FULL_MOCK')),
  mode                  TEXT NOT NULL DEFAULT 'PRACTICE'
                        CHECK (mode IN ('PRACTICE', 'STANDARD_EXAM', 'STRICT_EXAM')),
  status                TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                        CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED')),
  started_at            TEXT NOT NULL,
  deadline_at           TEXT,                          -- null when untimed
  submitted_at          TEXT,
  submitted_reason      TEXT CHECK (submitted_reason IN ('CANDIDATE', 'TIMEOUT', 'INTEGRITY_AUTO', 'ADMIN')),
  current_component_index INTEGER NOT NULL DEFAULT 0,
  integrity_policy_json TEXT NOT NULL DEFAULT '{}',    -- frozen copy of the policy in force
  result_visibility     TEXT NOT NULL DEFAULT 'IMMEDIATE'
                        CHECK (result_visibility IN ('IMMEDIATE', 'AFTER_DEADLINE', 'SCORE_ONLY', 'NO_REVIEW')),
  scoring_profile_id    TEXT REFERENCES scoring_profiles (id) ON DELETE SET NULL,
  scoring_profile_version INTEGER,
  raw_score             INTEGER,
  total_questions       INTEGER,
  estimated_band        REAL,
  marked_at             TEXT,
  marked_revision       INTEGER NOT NULL DEFAULT 0,
  client_meta_json      TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_attempts_user ON attempts (user_id, created_at);
CREATE INDEX idx_attempts_assignment ON attempts (assignment_id);
CREATE INDEX idx_attempts_version ON attempts (test_version_id);
CREATE INDEX idx_attempts_status ON attempts (status);

CREATE TABLE attempt_skill_sessions (
  id                    TEXT PRIMARY KEY,
  attempt_id            TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  component_index       INTEGER NOT NULL,
  skill                 TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
  test_version_id       TEXT NOT NULL REFERENCES test_versions (id),
  label                 TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                        CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
  started_at            TEXT,
  deadline_at           TEXT,
  submitted_at          TEXT,
  duration_seconds      INTEGER,
  raw_score             INTEGER,
  total_questions       INTEGER,
  estimated_band        REAL,
  scoring_profile_id    TEXT REFERENCES scoring_profiles (id) ON DELETE SET NULL,
  scoring_profile_version INTEGER,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (attempt_id, component_index)
);
CREATE INDEX idx_skill_sessions_attempt ON attempt_skill_sessions (attempt_id);

CREATE TABLE attempt_answers (
  id               TEXT PRIMARY KEY,
  attempt_id       TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  skill_session_id TEXT NOT NULL REFERENCES attempt_skill_sessions (id) ON DELETE CASCADE,
  question_id      TEXT NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  test_version_id  TEXT NOT NULL,
  answer_json      TEXT,                              -- null / cleared answer
  is_flagged       INTEGER NOT NULL DEFAULT 0,
  answered_at      TEXT,
  updated_at       TEXT NOT NULL,
  is_correct       INTEGER,                           -- filled by server-side marking only
  points           REAL,
  marked_at        TEXT,
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX idx_attempt_answers_attempt ON attempt_answers (attempt_id);
CREATE INDEX idx_attempt_answers_session ON attempt_answers (skill_session_id);
CREATE INDEX idx_attempt_answers_question ON attempt_answers (question_id);

CREATE TABLE integrity_events (
  id               TEXT PRIMARY KEY,
  attempt_id       TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  skill_session_id TEXT REFERENCES attempt_skill_sessions (id) ON DELETE SET NULL,
  type             TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  occurred_at      TEXT NOT NULL,                     -- client clock (untrusted, informational)
  recorded_at      TEXT NOT NULL,                     -- server clock (authoritative)
  client_seq       INTEGER,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  user_agent       TEXT
);
CREATE INDEX idx_integrity_attempt ON integrity_events (attempt_id, recorded_at);
CREATE INDEX idx_integrity_type ON integrity_events (type);

CREATE TABLE writing_submissions (
  id               TEXT PRIMARY KEY,
  attempt_id       TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  skill_session_id TEXT NOT NULL REFERENCES attempt_skill_sessions (id) ON DELETE CASCADE,
  question_id      TEXT REFERENCES questions (id) ON DELETE SET NULL,
  test_version_id  TEXT NOT NULL,
  task_label       TEXT NOT NULL DEFAULT '',
  prompt_snapshot  TEXT NOT NULL DEFAULT '',
  response_text    TEXT NOT NULL DEFAULT '',
  word_count       INTEGER NOT NULL DEFAULT 0,
  submitted_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX idx_writing_attempt ON writing_submissions (attempt_id);

CREATE TABLE writing_scores (
  id                    TEXT PRIMARY KEY,
  writing_submission_id TEXT NOT NULL UNIQUE REFERENCES writing_submissions (id) ON DELETE CASCADE,
  band                  REAL,
  criteria_json         TEXT NOT NULL DEFAULT '{}',
  feedback              TEXT NOT NULL DEFAULT '',
  scoring_source        TEXT NOT NULL CHECK (scoring_source IN ('TEACHER', 'ADMIN', 'IMPORTED')),
  scored_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  scored_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_writing_scores_source ON writing_scores (scoring_source);

-- -----------------------------------------------------------------------------
-- Imports (AI-assisted authoring pipeline) & drafts
-- -----------------------------------------------------------------------------
CREATE TABLE imports (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  filename          TEXT NOT NULL DEFAULT '',
  mime              TEXT NOT NULL DEFAULT '',
  size_bytes        INTEGER NOT NULL DEFAULT 0,
  r2_key            TEXT,
  status            TEXT NOT NULL DEFAULT 'UPLOADED'
                    CHECK (status IN ('UPLOADED', 'PROCESSING', 'AI_STRUCTURED', 'VALIDATED', 'REVIEW', 'FAILED', 'PUBLISHED', 'DISCARDED')),
  ai_used           INTEGER NOT NULL DEFAULT 0,
  ai_model          TEXT,
  extracted_chars   INTEGER NOT NULL DEFAULT 0,
  notes             TEXT NOT NULL DEFAULT '',
  target_test_id    TEXT REFERENCES tests (id) ON DELETE SET NULL,
  created_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  content_origin    TEXT NOT NULL DEFAULT 'IMPORTED'
                    CHECK (content_origin IN ('ORIGINAL', 'LICENSED', 'AI_GENERATED', 'IMPORTED', 'OFFICIAL_PROVIDER')),
  source_title      TEXT,
  source_url        TEXT,
  attribution       TEXT,
  license_notes     TEXT
);
CREATE INDEX idx_imports_status ON imports (status);
CREATE INDEX idx_imports_created_by ON imports (created_by);

CREATE TABLE import_jobs (
  id          TEXT PRIMARY KEY,
  import_id   TEXT NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('UPLOAD', 'EXTRACT', 'AI_STRUCTURE', 'VALIDATE', 'REVIEW', 'PUBLISH')),
  status      TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  log_json    TEXT NOT NULL DEFAULT '[]',
  started_at  TEXT,
  finished_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_import_jobs_import ON import_jobs (import_id);

CREATE TABLE import_drafts (
  id              TEXT PRIMARY KEY,
  import_id       TEXT NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  test_version_id TEXT REFERENCES test_versions (id) ON DELETE SET NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT,
  status          TEXT NOT NULL DEFAULT 'REVIEW' CHECK (status IN ('REVIEW', 'APPLIED', 'DISCARDED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_import_drafts_import ON import_drafts (import_id);

-- -----------------------------------------------------------------------------
-- Administrative audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE admin_audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_audit_actor ON admin_audit_logs (actor_user_id, created_at);
CREATE INDEX idx_audit_entity ON admin_audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_created ON admin_audit_logs (created_at);
