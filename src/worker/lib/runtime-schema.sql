-- =============================================================================
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run schema:generate
--
-- Idempotent copy of the final schema produced by replaying migrations/
-- (0001_init.sql, 0002_imports_and_settings.sql, 0003_url_assets.sql, 0004_test_access_codes.sql, 0005_sections_and_parts.sql, 0006_vocabulary_notebook.sql, 0007_ai_speaking_and_media.sql, 0008_speaking_review.sql, 0009_learn_and_vocabulary.sql, 0010_sample_writing_copy.sql, 0011_learn_lessons.sql, 0012_learn_lesson_kinds.sql, 0013_learn_plans.sql, 0014_speech_cache.sql, 0015_lesson_video.sql, 0016_lesson_legendary.sql, 0017_learn_shop_and_quests.sql, 0018_social_profiles_and_daily_lessons.sql, 0019_ai_adjudications.sql, 0020_mentor.sql, 0021_avatars_and_class_chat.sql, 0022_speaking_custom_topic.sql, 0023_accounts_username_2fa_otp.sql, 0024_classroom_chat.sql, 0025_room_moderation_booking.sql, 0026_calendar_events.sql, 0027_profile_bio_links.sql, 0028_mock_speaking.sql, 0029_classroom_chat_files.sql, 0030_user_identities.sql, 0031_notifications_email_links.sql, 0032_mentor_booking_confirmation.sql, 0033_live_classroom.sql, 0034_message_rooms.sql, 0035_room_presence_media.sql, 0036_weekly_action_plans.sql, 0037_ai_tutor.sql). The Worker runs this once per isolate against
-- an un-initialised database so a deployment cannot end up in a state where
-- every request fails with "no such table".
--
-- Tables: 83   Indexes: 99
-- =============================================================================

-- table: user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  target_band  REAL,
  timezone     TEXT,
  locale       TEXT NOT NULL DEFAULT 'en',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
, avatar_id TEXT NOT NULL DEFAULT 'bo', name_effect TEXT NOT NULL DEFAULT 'default', profile_effect TEXT NOT NULL DEFAULT 'none', avatar_updated_at TEXT, avatar_mime TEXT, totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, bio TEXT NOT NULL DEFAULT '', links_json TEXT NOT NULL DEFAULT '');

-- table: sessions
CREATE TABLE IF NOT EXISTS sessions (
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

-- table: rate_limit_counters
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,                     -- epoch seconds, floor(now / window)
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

-- table: login_attempts
CREATE TABLE IF NOT EXISTS login_attempts (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  ip         TEXT,
  success    INTEGER NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL
);

-- table: classrooms
CREATE TABLE IF NOT EXISTS classrooms (
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

-- table: classroom_members
CREATE TABLE IF NOT EXISTS classroom_members (
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

-- table: classroom_invites
CREATE TABLE IF NOT EXISTS classroom_invites (
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

-- table: tests
CREATE TABLE IF NOT EXISTS tests (
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
, access_code_hash TEXT, access_code_salt TEXT, access_code_iterations INTEGER, access_code_set_at TEXT, access_code_set_by TEXT REFERENCES users (id) ON DELETE SET NULL);

-- table: test_versions
CREATE TABLE IF NOT EXISTS test_versions (
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

-- table: passages
CREATE TABLE IF NOT EXISTS passages (
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

-- table: sections
CREATE TABLE IF NOT EXISTS sections (
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
, type TEXT
  CHECK (type IS NULL OR type IN ('READING_PASSAGE', 'LISTENING_PART', 'WRITING_TASK')), label TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', transcript_json TEXT, image_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL);

-- table: question_groups
CREATE TABLE IF NOT EXISTS question_groups (
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

-- table: questions
CREATE TABLE IF NOT EXISTS questions (
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

-- table: answer_keys
CREATE TABLE IF NOT EXISTS answer_keys (
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

-- table: scoring_profiles
CREATE TABLE IF NOT EXISTS scoring_profiles (
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

-- table: score_conversion_ranges
CREATE TABLE IF NOT EXISTS score_conversion_ranges (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES scoring_profiles (id) ON DELETE CASCADE,
  raw_min     INTEGER NOT NULL,
  raw_max     INTEGER NOT NULL,
  band        REAL NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- table: mock_components
CREATE TABLE IF NOT EXISTS mock_components (
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

-- table: assignments
CREATE TABLE IF NOT EXISTS assignments (
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

-- table: attempts
CREATE TABLE IF NOT EXISTS attempts (
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

-- table: attempt_skill_sessions
CREATE TABLE IF NOT EXISTS attempt_skill_sessions (
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

-- table: attempt_answers
CREATE TABLE IF NOT EXISTS attempt_answers (
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

-- table: integrity_events
CREATE TABLE IF NOT EXISTS integrity_events (
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

-- table: writing_submissions
CREATE TABLE IF NOT EXISTS writing_submissions (
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

-- table: imports
CREATE TABLE IF NOT EXISTS imports (
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
, extracted_r2_key TEXT, structured_payload_json TEXT, answer_key_confidence TEXT
  CHECK (answer_key_confidence IN ('PROVIDED', 'PARTIAL', 'ABSENT')), source_text TEXT);

-- table: import_jobs
CREATE TABLE IF NOT EXISTS import_jobs (
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

-- table: import_drafts
CREATE TABLE IF NOT EXISTS import_drafts (
  id              TEXT PRIMARY KEY,
  import_id       TEXT NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  test_version_id TEXT REFERENCES test_versions (id) ON DELETE SET NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  validation_json TEXT,
  status          TEXT NOT NULL DEFAULT 'REVIEW' CHECK (status IN ('REVIEW', 'APPLIED', 'DISCARDED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- table: admin_audit_logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
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

-- table: platform_settings
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

-- table: assets
CREATE TABLE IF NOT EXISTS "assets" (
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

-- table: test_unlocks
CREATE TABLE IF NOT EXISTS test_unlocks (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  test_id     TEXT NOT NULL REFERENCES tests (id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, test_id)
);

-- table: attempt_sections
CREATE TABLE IF NOT EXISTS attempt_sections (
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
  updated_at      TEXT NOT NULL, raw_score INTEGER, total_marked INTEGER,
  UNIQUE (attempt_id, section_id)
);

-- table: vocabulary_entries
CREATE TABLE IF NOT EXISTS vocabulary_entries (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  term         TEXT NOT NULL,
  meaning      TEXT NOT NULL DEFAULT '',
  note         TEXT,
  source       TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
, meaning_vi TEXT NOT NULL DEFAULT '', pos        TEXT NOT NULL DEFAULT '', phonetic   TEXT NOT NULL DEFAULT '', example    TEXT NOT NULL DEFAULT '', level      REAL, origin     TEXT NOT NULL DEFAULT 'USER', box        INTEGER NOT NULL DEFAULT 0, due_at     TEXT);

-- table: writing_scores
CREATE TABLE IF NOT EXISTS "writing_scores" (
  id                    TEXT PRIMARY KEY,
  writing_submission_id TEXT NOT NULL UNIQUE REFERENCES writing_submissions (id) ON DELETE CASCADE,
  band                  REAL,
  criteria_json         TEXT NOT NULL DEFAULT '{}',
  feedback              TEXT NOT NULL DEFAULT '',
  scoring_source        TEXT NOT NULL CHECK (scoring_source IN ('TEACHER', 'ADMIN', 'IMPORTED', 'AI')),
  scored_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  scored_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- table: ai_scores
CREATE TABLE IF NOT EXISTS ai_scores (
  id                TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES users (id) ON DELETE SET NULL,
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('WRITING', 'SPEAKING', 'IMPORT', 'QUESTION')),
  entity_id         TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'BAND',
  provider_id       TEXT,
  provider_model    TEXT,
  band              REAL,
  criteria_json     TEXT NOT NULL DEFAULT '{}',
  feedback          TEXT NOT NULL DEFAULT '',
  raw_json          TEXT NOT NULL DEFAULT '{}',
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TEXT NOT NULL
);

-- table: speaking_sessions
CREATE TABLE IF NOT EXISTS speaking_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'PRACTICE' CHECK (mode IN ('PRACTICE', 'MOCK')),
  status         TEXT NOT NULL DEFAULT 'IN_PROGRESS'
                 CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'MARKED', 'FAILED')),
  topic_set_id   TEXT NOT NULL,
  topic_title    TEXT NOT NULL DEFAULT '',
  part_count     INTEGER NOT NULL DEFAULT 3,
  overall_band   REAL,
  transcript     TEXT NOT NULL DEFAULT '',
  feedback       TEXT NOT NULL DEFAULT '',
  criteria_json  TEXT NOT NULL DEFAULT '{}',
  provider_id    TEXT,
  provider_model TEXT,
  marked_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
, score_source TEXT, scored_by TEXT REFERENCES users (id) ON DELETE SET NULL, scored_at TEXT, topic_json TEXT, source_attempt_id TEXT);

-- table: speaking_responses
CREATE TABLE IF NOT EXISTS speaking_responses (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES speaking_sessions (id) ON DELETE CASCADE,
  part             INTEGER NOT NULL CHECK (part IN (1, 2, 3)),
  prompt_text      TEXT NOT NULL DEFAULT '',
  transcript       TEXT NOT NULL DEFAULT '',
  duration_seconds REAL NOT NULL DEFAULT 0,
  words            INTEGER NOT NULL DEFAULT 0,
  mime             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (session_id, part)
);

-- table: speaking_recording_blobs
CREATE TABLE IF NOT EXISTS speaking_recording_blobs (
  response_id TEXT NOT NULL REFERENCES speaking_responses (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'audio/webm',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (response_id, chunk_index)
);

-- table: asset_blobs
CREATE TABLE IF NOT EXISTS asset_blobs (
  asset_id    TEXT NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (asset_id, chunk_index)
);

-- table: learn_profiles
CREATE TABLE IF NOT EXISTS learn_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  xp              INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  best_streak     INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  daily_goal_xp   INTEGER NOT NULL DEFAULT 30,
  start_band      REAL,
  last_words_day  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
, band_source TEXT NOT NULL DEFAULT '', coins INTEGER NOT NULL DEFAULT 0, xp_boost_until TEXT NOT NULL DEFAULT '');

-- table: learn_lessons_done
CREATE TABLE IF NOT EXISTS learn_lessons_done (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id         TEXT NOT NULL,
  stars             INTEGER NOT NULL DEFAULT 0,
  best_accuracy     REAL NOT NULL DEFAULT 0,
  completions       INTEGER NOT NULL DEFAULT 0,
  xp_earned         INTEGER NOT NULL DEFAULT 0,
  last_completed_at TEXT NOT NULL,
  UNIQUE (user_id, lesson_id)
);

-- table: learn_xp_log
CREATE TABLE IF NOT EXISTS learn_xp_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  xp         INTEGER NOT NULL,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- table: dictionary_cache
CREATE TABLE IF NOT EXISTS dictionary_cache (
  term         TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  source       TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

-- table: learn_lessons
CREATE TABLE IF NOT EXISTS "learn_lessons" (
  id           TEXT PRIMARY KEY,
  band         REAL NOT NULL,
  unit_key     TEXT NOT NULL,
  unit_title   TEXT NOT NULL DEFAULT '',
  unit_blurb   TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  blurb        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT 'VOCAB'
               CHECK (kind IN ('VOCAB', 'PARAPHRASE', 'READING', 'WRITING', 'SPEAKING')),
  payload_json TEXT NOT NULL,
  origin       TEXT NOT NULL DEFAULT 'BUILT_IN'
               CHECK (origin IN ('BUILT_IN', 'ADMIN_AI', 'PERSONAL_AI')),
  status       TEXT NOT NULL DEFAULT 'PUBLISHED'
               CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  owner_id     TEXT REFERENCES users (id) ON DELETE CASCADE,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
, video_url TEXT NOT NULL DEFAULT '', legendary INTEGER NOT NULL DEFAULT 0);

-- table: learn_plans
CREATE TABLE IF NOT EXISTS learn_plans (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_band     REAL NOT NULL,
  exam_date       TEXT,
  minutes_per_day INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- table: learn_plan_items
CREATE TABLE IF NOT EXISTS learn_plan_items (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES learn_plans (id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  slot         INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL CHECK (kind IN ('LESSON', 'REVIEW', 'MOCK_TEST')),
  lesson_id    TEXT REFERENCES learn_lessons (id) ON DELETE SET NULL,
  label        TEXT NOT NULL DEFAULT '',
  band         REAL,
  skill        TEXT CHECK (skill IS NULL OR skill IN ('READING', 'LISTENING', 'WRITING', 'OVERALL')),
  status       TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'DONE', 'SKIPPED')),
  completed_at TEXT,
  created_at   TEXT NOT NULL
);

-- table: speech_cache
CREATE TABLE IF NOT EXISTS speech_cache (
  cache_key  TEXT PRIMARY KEY,
  voice      TEXT NOT NULL,
  text_hash  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  data_b64   TEXT NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- table: learn_inventory
CREATE TABLE IF NOT EXISTS learn_inventory (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_key)
);

-- table: learn_shop_orders
CREATE TABLE IF NOT EXISTS learn_shop_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_key      TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_price    INTEGER NOT NULL,
  coins_spent   INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

-- table: learn_coin_log
CREATE TABLE IF NOT EXISTS learn_coin_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL DEFAULT '',
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- table: learn_quest_rewards
CREATE TABLE IF NOT EXISTS learn_quest_rewards (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  quest      TEXT NOT NULL,
  coins      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, quest)
);

-- table: learn_translations
CREATE TABLE IF NOT EXISTS learn_translations (
  hash       TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  vi         TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'AI' CHECK (source IN ('AI')),
  created_at TEXT NOT NULL
);

-- table: friendships
CREATE TABLE IF NOT EXISTS friendships (
  user_low_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by = user_low_id OR requested_by = user_high_id)
);

-- table: learn_daily_lessons
CREATE TABLE IF NOT EXISTS learn_daily_lessons (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  band       REAL NOT NULL,
  slot       INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 5),
  lesson_id  TEXT NOT NULL REFERENCES learn_lessons (id) ON DELETE CASCADE,
  quote      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, band, slot),
  UNIQUE (user_id, day, band, lesson_id)
);

-- table: ai_adjudications
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

-- table: users
CREATE TABLE IF NOT EXISTS "users" (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  role                TEXT NOT NULL CHECK (role IN ('STUDENT', 'TEACHER', 'ADMIN', 'MENTOR')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INVITED')),
  password_algo       TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  password_hash       TEXT,
  password_salt       TEXT,
  password_iterations INTEGER,
  created_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  last_login_at       TEXT,
  failed_login_count  INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT
, username TEXT);

-- table: mentor_profiles
CREATE TABLE IF NOT EXISTS mentor_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  headline          TEXT NOT NULL DEFAULT '',
  bio               TEXT NOT NULL DEFAULT '',
  specialties       TEXT NOT NULL DEFAULT '[]',   -- JSON array of MentorSpecialty
  languages         TEXT NOT NULL DEFAULT '[]',   -- JSON array of language names
  hourly_rate_coins INTEGER NOT NULL DEFAULT 0,
  years_experience  INTEGER NOT NULL DEFAULT 0,
  rating_avg        REAL NOT NULL DEFAULT 0,
  rating_count      INTEGER NOT NULL DEFAULT 0,
  students_count    INTEGER NOT NULL DEFAULT 0,
  sessions_count    INTEGER NOT NULL DEFAULT 0,
  verified          INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- table: mentor_availability
CREATE TABLE IF NOT EXISTS mentor_availability (
  id           TEXT PRIMARY KEY,
  mentor_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute   INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at   TEXT NOT NULL,
  CHECK (start_minute < end_minute)
);

-- table: mentor_classes
CREATE TABLE IF NOT EXISTS mentor_classes (
  id          TEXT PRIMARY KEY,
  mentor_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level       TEXT NOT NULL DEFAULT 'All levels',
  capacity    INTEGER NOT NULL DEFAULT 10,
  price_coins INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'LIVE', 'COMPLETED', 'CANCELLED')),
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  recurrence  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- table: mentor_sessions
CREATE TABLE IF NOT EXISTS mentor_sessions (
  id              TEXT PRIMARY KEY,
  mentor_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  class_id        TEXT REFERENCES mentor_classes (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'ONE_ON_ONE' CHECK (kind IN ('ONE_ON_ONE', 'CLASS')),
  status          TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  topic           TEXT NOT NULL DEFAULT '',
  notes           TEXT,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT,
  paid_coins      INTEGER NOT NULL DEFAULT 0,
  student_rating  INTEGER,
  mentor_feedback TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
, confirmation TEXT NOT NULL DEFAULT 'CONFIRMED'
  CHECK (confirmation IN ('REQUESTED', 'CONFIRMED', 'DECLINED', 'NONE')));

-- table: mentor_class_members
CREATE TABLE IF NOT EXISTS mentor_class_members (
  class_id   TEXT NOT NULL REFERENCES mentor_classes (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  PRIMARY KEY (class_id, user_id)
);

-- table: mentor_messages
CREATE TABLE IF NOT EXISTS mentor_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'CHAT' CHECK (kind IN ('CHAT', 'SYSTEM', 'NOTE')),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
, room_key TEXT NOT NULL DEFAULT 'main');

-- table: mentor_reviews
CREATE TABLE IF NOT EXISTS mentor_reviews (
  id         TEXT PRIMARY KEY,
  mentor_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT REFERENCES mentor_sessions (id) ON DELETE SET NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- table: mentor_room_presence
CREATE TABLE IF NOT EXISTS mentor_room_presence (
  session_id  TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hand_raised INTEGER NOT NULL DEFAULT 0, room_key TEXT NOT NULL DEFAULT 'main', cam_on INTEGER NOT NULL DEFAULT 1, mic_on INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, user_id)
);

-- table: profile_avatars
CREATE TABLE IF NOT EXISTS profile_avatars (
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  mime        TEXT NOT NULL DEFAULT 'image/png',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, chunk_index)
);

-- table: mentor_class_messages
CREATE TABLE IF NOT EXISTS mentor_class_messages (
  id         TEXT PRIMARY KEY,
  class_id   TEXT NOT NULL REFERENCES mentor_classes (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- table: login_otp_codes
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

-- table: classroom_messages
CREATE TABLE IF NOT EXISTS classroom_messages (
  id         TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
, attachment_url TEXT, attachment_name TEXT);

-- table: mentor_room_bans
CREATE TABLE IF NOT EXISTS mentor_room_bans (
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  banned_by  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- table: calendar_events
CREATE TABLE IF NOT EXISTS calendar_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- table: user_identities
CREATE TABLE IF NOT EXISTS user_identities (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider   TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  subject    TEXT NOT NULL,
  email      TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, subject)
);

-- table: notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

-- table: email_outbox
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  provider TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

-- table: auth_links
CREATE TABLE IF NOT EXISTS auth_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('MAGIC', 'RESET')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- table: class_polls
CREATE TABLE IF NOT EXISTS class_polls (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  room_key      TEXT NOT NULL DEFAULT 'main',
  created_by    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'QUIZ' CHECK (kind IN ('QUIZ', 'POLL')),
  question      TEXT NOT NULL,
  options_json  TEXT NOT NULL,
  correct_index INTEGER,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at    TEXT NOT NULL,
  closed_at     TEXT
);

-- table: class_poll_answers
CREATE TABLE IF NOT EXISTS class_poll_answers (
  poll_id      TEXT NOT NULL REFERENCES class_polls (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  choice_index INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);

-- table: class_breakouts
CREATE TABLE IF NOT EXISTS class_breakouts (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  room_key   TEXT NOT NULL,
  ends_at    TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, room_key)
);

-- table: class_breakout_members
CREATE TABLE IF NOT EXISTS class_breakout_members (
  breakout_id TEXT NOT NULL REFERENCES class_breakouts (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (breakout_id, user_id)
);

-- table: class_whiteboards
CREATE TABLE IF NOT EXISTS class_whiteboards (
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  room_key   TEXT NOT NULL DEFAULT 'main',
  revision   INTEGER NOT NULL DEFAULT 0,
  strokes_json TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, room_key)
);

-- table: user_digests
CREATE TABLE IF NOT EXISTS user_digests (
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, week_key)
);

-- table: mentor_signals
CREATE TABLE IF NOT EXISTS "mentor_signals" (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mentor_sessions (id) ON DELETE CASCADE,
  sender_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_id  TEXT,
  room_key   TEXT NOT NULL DEFAULT 'main',
  kind       TEXT NOT NULL CHECK (kind IN ('OFFER', 'ANSWER', 'CANDIDATE', 'BYE', 'HAND', 'MUTE_MIC', 'UNMUTE_MIC', 'KICK', 'REACTION', 'WHITEBOARD')),
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- table: weekly_action_plans
CREATE TABLE IF NOT EXISTS weekly_action_plans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  plan_json   TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'RULES' CHECK (source IN ('RULES', 'AI')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (user_id, week_start)
);

-- table: tutor_conversations
CREATE TABLE IF NOT EXISTS tutor_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New chat',
  focus_skill TEXT NOT NULL DEFAULT 'ANY' CHECK (focus_skill IN ('ANY', 'WRITING', 'SPEAKING', 'READING', 'LISTENING', 'VOCABULARY')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- table: tutor_messages
CREATE TABLE IF NOT EXISTS tutor_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES tutor_conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- index: idx_sessions_user
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- index: idx_sessions_expiry
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- index: idx_login_attempts_email_time
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts (email, created_at);

-- index: idx_login_attempts_ip_time
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts (ip, created_at);

-- index: idx_classrooms_teacher
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms (teacher_id);

-- index: idx_classroom_members_user
CREATE INDEX IF NOT EXISTS idx_classroom_members_user ON classroom_members (user_id);

-- index: idx_classroom_members_classroom
CREATE INDEX IF NOT EXISTS idx_classroom_members_classroom ON classroom_members (classroom_id);

-- index: idx_classroom_invites_classroom
CREATE INDEX IF NOT EXISTS idx_classroom_invites_classroom ON classroom_invites (classroom_id);

-- index: idx_classroom_invites_email
CREATE INDEX IF NOT EXISTS idx_classroom_invites_email ON classroom_invites (email);

-- index: idx_tests_type_status
CREATE INDEX IF NOT EXISTS idx_tests_type_status ON tests (type, status);

-- index: idx_test_versions_test
CREATE INDEX IF NOT EXISTS idx_test_versions_test ON test_versions (test_id);

-- index: idx_test_versions_status
CREATE INDEX IF NOT EXISTS idx_test_versions_status ON test_versions (status);

-- index: idx_passages_version
CREATE INDEX IF NOT EXISTS idx_passages_version ON passages (test_version_id);

-- index: idx_sections_version
CREATE INDEX IF NOT EXISTS idx_sections_version ON sections (test_version_id);

-- index: idx_question_groups_section
CREATE INDEX IF NOT EXISTS idx_question_groups_section ON question_groups (section_id);

-- index: idx_question_groups_version
CREATE INDEX IF NOT EXISTS idx_question_groups_version ON question_groups (test_version_id);

-- index: idx_questions_section
CREATE INDEX IF NOT EXISTS idx_questions_section ON questions (section_id);

-- index: idx_questions_group
CREATE INDEX IF NOT EXISTS idx_questions_group ON questions (question_group_id);

-- index: idx_questions_version
CREATE INDEX IF NOT EXISTS idx_questions_version ON questions (test_version_id);

-- index: idx_answer_keys_version
CREATE INDEX IF NOT EXISTS idx_answer_keys_version ON answer_keys (test_version_id);

-- index: idx_conversion_profile
CREATE INDEX IF NOT EXISTS idx_conversion_profile ON score_conversion_ranges (profile_id);

-- index: idx_mock_components_version
CREATE INDEX IF NOT EXISTS idx_mock_components_version ON mock_components (mock_version_id);

-- index: idx_assignments_classroom
CREATE INDEX IF NOT EXISTS idx_assignments_classroom ON assignments (classroom_id);

-- index: idx_assignments_teacher
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments (teacher_id);

-- index: idx_assignments_version
CREATE INDEX IF NOT EXISTS idx_assignments_version ON assignments (test_version_id);

-- index: idx_attempts_user
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts (user_id, created_at);

-- index: idx_attempts_assignment
CREATE INDEX IF NOT EXISTS idx_attempts_assignment ON attempts (assignment_id);

-- index: idx_attempts_version
CREATE INDEX IF NOT EXISTS idx_attempts_version ON attempts (test_version_id);

-- index: idx_attempts_status
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts (status);

-- index: idx_skill_sessions_attempt
CREATE INDEX IF NOT EXISTS idx_skill_sessions_attempt ON attempt_skill_sessions (attempt_id);

-- index: idx_attempt_answers_attempt
CREATE INDEX IF NOT EXISTS idx_attempt_answers_attempt ON attempt_answers (attempt_id);

-- index: idx_attempt_answers_session
CREATE INDEX IF NOT EXISTS idx_attempt_answers_session ON attempt_answers (skill_session_id);

-- index: idx_attempt_answers_question
CREATE INDEX IF NOT EXISTS idx_attempt_answers_question ON attempt_answers (question_id);

-- index: idx_integrity_attempt
CREATE INDEX IF NOT EXISTS idx_integrity_attempt ON integrity_events (attempt_id, recorded_at);

-- index: idx_integrity_type
CREATE INDEX IF NOT EXISTS idx_integrity_type ON integrity_events (type);

-- index: idx_writing_attempt
CREATE INDEX IF NOT EXISTS idx_writing_attempt ON writing_submissions (attempt_id);

-- index: idx_imports_status
CREATE INDEX IF NOT EXISTS idx_imports_status ON imports (status);

-- index: idx_imports_created_by
CREATE INDEX IF NOT EXISTS idx_imports_created_by ON imports (created_by);

-- index: idx_import_jobs_import
CREATE INDEX IF NOT EXISTS idx_import_jobs_import ON import_jobs (import_id);

-- index: idx_import_drafts_import
CREATE INDEX IF NOT EXISTS idx_import_drafts_import ON import_drafts (import_id);

-- index: idx_audit_actor
CREATE INDEX IF NOT EXISTS idx_audit_actor ON admin_audit_logs (actor_user_id, created_at);

-- index: idx_audit_entity
CREATE INDEX IF NOT EXISTS idx_audit_entity ON admin_audit_logs (entity_type, entity_id);

-- index: idx_audit_created
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs (created_at);

-- index: idx_assets_version
CREATE INDEX IF NOT EXISTS idx_assets_version ON assets (test_version_id);

-- index: idx_assets_kind
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets (kind, created_at);

-- index: idx_test_unlocks_test
CREATE INDEX IF NOT EXISTS idx_test_unlocks_test ON test_unlocks (test_id);

-- index: idx_sections_image
CREATE INDEX IF NOT EXISTS idx_sections_image ON sections (image_asset_id);

-- index: idx_attempt_sections_attempt
CREATE INDEX IF NOT EXISTS idx_attempt_sections_attempt ON attempt_sections (attempt_id, section_order);

-- index: idx_vocabulary_user_term
CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_user_term ON vocabulary_entries (user_id, term);

-- index: idx_vocabulary_user_created
CREATE INDEX IF NOT EXISTS idx_vocabulary_user_created ON vocabulary_entries (user_id, created_at DESC);

-- index: idx_writing_scores_source
CREATE INDEX IF NOT EXISTS idx_writing_scores_source ON writing_scores (scoring_source);

-- index: idx_ai_scores_entity
CREATE INDEX IF NOT EXISTS idx_ai_scores_entity ON ai_scores (entity_type, entity_id, created_at DESC);

-- index: idx_ai_scores_user
CREATE INDEX IF NOT EXISTS idx_ai_scores_user ON ai_scores (user_id, created_at DESC);

-- index: idx_speaking_sessions_user
CREATE INDEX IF NOT EXISTS idx_speaking_sessions_user ON speaking_sessions (user_id, created_at DESC);

-- index: idx_speaking_sessions_status
CREATE INDEX IF NOT EXISTS idx_speaking_sessions_status ON speaking_sessions (status, created_at DESC);

-- index: idx_vocabulary_due
CREATE INDEX IF NOT EXISTS idx_vocabulary_due ON vocabulary_entries (user_id, due_at);

-- index: idx_learn_xp_user_day
CREATE INDEX IF NOT EXISTS idx_learn_xp_user_day ON learn_xp_log (user_id, day);

-- index: idx_learn_lessons_band
CREATE INDEX IF NOT EXISTS idx_learn_lessons_band ON learn_lessons (band, status, position);

-- index: idx_learn_lessons_owner
CREATE INDEX IF NOT EXISTS idx_learn_lessons_owner ON learn_lessons (owner_id, band);

-- index: idx_learn_plans_user
CREATE INDEX IF NOT EXISTS idx_learn_plans_user ON learn_plans (user_id, status);

-- index: idx_learn_plan_items_day
CREATE INDEX IF NOT EXISTS idx_learn_plan_items_day ON learn_plan_items (plan_id, day, slot);

-- index: idx_speech_cache_created
CREATE INDEX IF NOT EXISTS idx_speech_cache_created ON speech_cache (created_at);

-- index: idx_learn_inventory_user
CREATE INDEX IF NOT EXISTS idx_learn_inventory_user ON learn_inventory (user_id);

-- index: idx_learn_orders_user
CREATE INDEX IF NOT EXISTS idx_learn_orders_user ON learn_shop_orders (user_id, created_at);

-- index: idx_learn_coin_user
CREATE INDEX IF NOT EXISTS idx_learn_coin_user ON learn_coin_log (user_id, day);

-- index: idx_friendships_requested_by
CREATE INDEX IF NOT EXISTS idx_friendships_requested_by ON friendships (requested_by, status, updated_at);

-- index: idx_learn_daily_lessons_user_day
CREATE INDEX IF NOT EXISTS idx_learn_daily_lessons_user_day ON learn_daily_lessons (user_id, day, band, slot);

-- index: idx_ai_adjudications_entity
CREATE INDEX IF NOT EXISTS idx_ai_adjudications_entity ON ai_adjudications (entity_type, entity_id);

-- index: idx_users_role
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- index: idx_mentor_profiles_active
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_active ON mentor_profiles (active, rating_avg DESC);

-- index: idx_mentor_availability_mentor
CREATE INDEX IF NOT EXISTS idx_mentor_availability_mentor ON mentor_availability (mentor_id, weekday);

-- index: idx_mentor_classes_mentor
CREATE INDEX IF NOT EXISTS idx_mentor_classes_mentor ON mentor_classes (mentor_id, starts_at);

-- index: idx_mentor_classes_status
CREATE INDEX IF NOT EXISTS idx_mentor_classes_status ON mentor_classes (status, starts_at);

-- index: idx_mentor_sessions_mentor
CREATE INDEX IF NOT EXISTS idx_mentor_sessions_mentor ON mentor_sessions (mentor_id, starts_at);

-- index: idx_mentor_sessions_student
CREATE INDEX IF NOT EXISTS idx_mentor_sessions_student ON mentor_sessions (student_id, starts_at);

-- index: idx_mentor_sessions_status
CREATE INDEX IF NOT EXISTS idx_mentor_sessions_status ON mentor_sessions (status, starts_at);

-- index: idx_mentor_class_members_user
CREATE INDEX IF NOT EXISTS idx_mentor_class_members_user ON mentor_class_members (user_id);

-- index: idx_mentor_messages_session
CREATE INDEX IF NOT EXISTS idx_mentor_messages_session ON mentor_messages (session_id, created_at);

-- index: idx_mentor_reviews_mentor
CREATE INDEX IF NOT EXISTS idx_mentor_reviews_mentor ON mentor_reviews (mentor_id, created_at DESC);

-- index: idx_mentor_class_messages_class
CREATE INDEX IF NOT EXISTS idx_mentor_class_messages_class ON mentor_class_messages (class_id, created_at);

-- index: idx_users_username
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)
  WHERE username IS NOT NULL;

-- index: idx_login_otp_user
CREATE INDEX IF NOT EXISTS idx_login_otp_user ON login_otp_codes (user_id, purpose, used_at);

-- index: idx_classroom_messages_classroom
CREATE INDEX IF NOT EXISTS idx_classroom_messages_classroom
  ON classroom_messages (classroom_id, created_at DESC);

-- index: idx_calendar_events_user_starts
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_starts
  ON calendar_events (user_id, starts_at);

-- index: idx_speaking_sessions_attempt
CREATE INDEX IF NOT EXISTS idx_speaking_sessions_attempt
  ON speaking_sessions (source_attempt_id);

-- index: idx_user_identities_user
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);

-- index: idx_notifications_user
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, read_at, created_at DESC);

-- index: idx_email_outbox_created
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox (created_at DESC);

-- index: idx_email_outbox_to
CREATE INDEX IF NOT EXISTS idx_email_outbox_to ON email_outbox (to_email, created_at DESC);

-- index: idx_auth_links_user
CREATE INDEX IF NOT EXISTS idx_auth_links_user
  ON auth_links (user_id, purpose, used_at, created_at DESC);

-- index: idx_mentor_sessions_confirmation
CREATE INDEX IF NOT EXISTS idx_mentor_sessions_confirmation
  ON mentor_sessions (confirmation, status, starts_at);

-- index: idx_class_polls_session
CREATE INDEX IF NOT EXISTS idx_class_polls_session ON class_polls (session_id, created_at DESC);

-- index: idx_class_breakouts_session
CREATE INDEX IF NOT EXISTS idx_class_breakouts_session ON class_breakouts (session_id);

-- index: idx_mentor_signals_session
CREATE INDEX IF NOT EXISTS idx_mentor_signals_session ON mentor_signals (session_id, room_key, created_at);

-- index: idx_mentor_presence_room
CREATE INDEX IF NOT EXISTS idx_mentor_presence_room ON mentor_room_presence (session_id, room_key, last_seen_at);

-- index: idx_mentor_messages_room
CREATE INDEX IF NOT EXISTS idx_mentor_messages_room ON mentor_messages (session_id, room_key, created_at);

-- index: idx_weekly_plan_user
CREATE INDEX IF NOT EXISTS idx_weekly_plan_user ON weekly_action_plans (user_id, week_start);

-- index: idx_tutor_conversations_user
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_user ON tutor_conversations (user_id, updated_at);

-- index: idx_tutor_messages_conversation
CREATE INDEX IF NOT EXISTS idx_tutor_messages_conversation ON tutor_messages (conversation_id, created_at);
