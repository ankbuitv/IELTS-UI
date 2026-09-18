-- Removes every row from the local development database.
-- Used by `npm run db:reset` (local only) so a fresh run starts from an empty
-- schema; follow it with `wrangler d1 migrations apply DB --local` and
-- `wrangler d1 execute DB --local --file=./seed/seed.sql`.
--
-- Order matters: children before parents, because the schema uses foreign keys.

DELETE FROM integrity_events;
DELETE FROM writing_scores;
DELETE FROM writing_submissions;
DELETE FROM attempt_answers;
DELETE FROM attempt_skill_sessions;
DELETE FROM attempts;
DELETE FROM assignments;
DELETE FROM mock_components;
DELETE FROM answer_keys;
DELETE FROM questions;
DELETE FROM question_groups;
DELETE FROM sections;
DELETE FROM passages;
DELETE FROM test_versions;
DELETE FROM tests;
DELETE FROM score_conversion_ranges;
DELETE FROM scoring_profiles;
DELETE FROM import_drafts;
DELETE FROM import_jobs;
DELETE FROM imports;
DELETE FROM classroom_invites;
DELETE FROM classroom_members;
DELETE FROM classrooms;
DELETE FROM admin_audit_logs;
DELETE FROM login_attempts;
DELETE FROM rate_limit_counters;
DELETE FROM sessions;
DELETE FROM user_profiles;
DELETE FROM users;
DELETE FROM assets;
DELETE FROM platform_settings;
