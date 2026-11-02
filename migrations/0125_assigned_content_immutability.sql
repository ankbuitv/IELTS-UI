-- Database-enforced immutability for versions referenced by an assignment.
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_passages_insert BEFORE INSERT ON passages
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_passages_update BEFORE UPDATE ON passages
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_passages_delete BEFORE DELETE ON passages
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_sections_insert BEFORE INSERT ON sections
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_sections_update BEFORE UPDATE ON sections
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_sections_delete BEFORE DELETE ON sections
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_question_groups_insert BEFORE INSERT ON question_groups
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_question_groups_update BEFORE UPDATE ON question_groups
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_question_groups_delete BEFORE DELETE ON question_groups
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_questions_insert BEFORE INSERT ON questions
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_questions_update BEFORE UPDATE ON questions
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_questions_delete BEFORE DELETE ON questions
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_answer_keys_insert BEFORE INSERT ON answer_keys
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_answer_keys_update BEFORE UPDATE ON answer_keys
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.test_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_answer_keys_delete BEFORE DELETE ON answer_keys
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.test_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_mock_components_insert BEFORE INSERT ON mock_components
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.mock_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_mock_components_update BEFORE UPDATE ON mock_components
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.mock_version_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=NEW.mock_version_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_mock_components_delete BEFORE DELETE ON mock_components
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.mock_version_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_version_update BEFORE UPDATE ON test_versions
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.id) AND (OLD.test_id IS NOT NEW.test_id OR OLD.version_number IS NOT NEW.version_number OR OLD.config_json IS NOT NEW.config_json OR OLD.total_questions IS NOT NEW.total_questions OR OLD.duration_seconds IS NOT NEW.duration_seconds OR OLD.is_complete_test IS NOT NEW.is_complete_test OR OLD.scoring_profile_id IS NOT NEW.scoring_profile_id OR OLD.frozen_snapshot_json IS NOT NEW.frozen_snapshot_json OR NEW.status NOT IN ('PUBLISHED','ARCHIVED'))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_version_delete BEFORE DELETE ON test_versions
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p WHERE p.id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_test_update BEFORE UPDATE ON tests
WHEN (OLD.title IS NOT NEW.title OR OLD.type IS NOT NEW.type) AND EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN test_versions v ON v.id=p.id WHERE v.test_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_test_delete BEFORE DELETE ON tests
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN test_versions v ON v.id=p.id WHERE v.test_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_update BEFORE UPDATE ON assets
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=OLD.id OR s.image_asset_id=OLD.id) AND (OLD.kind IS NOT NEW.kind OR OLD.storage_kind IS NOT NEW.storage_kind OR OLD.external_url IS NOT NEW.external_url OR OLD.r2_key IS NOT NEW.r2_key OR OLD.filename IS NOT NEW.filename OR OLD.mime IS NOT NEW.mime OR OLD.size_bytes IS NOT NEW.size_bytes OR OLD.checksum_sha256 IS NOT NEW.checksum_sha256 OR OLD.duration_seconds IS NOT NEW.duration_seconds OR OLD.width IS NOT NEW.width OR OLD.height IS NOT NEW.height OR OLD.alt_text IS NOT NEW.alt_text OR OLD.visibility IS NOT NEW.visibility OR OLD.test_version_id IS NOT NEW.test_version_id OR OLD.uploaded_by IS NOT NEW.uploaded_by)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_delete BEFORE DELETE ON assets
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=OLD.id OR s.image_asset_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_blob_insert BEFORE INSERT ON asset_blobs
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=NEW.asset_id OR s.image_asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_blob_update BEFORE UPDATE ON asset_blobs
WHEN (EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=OLD.asset_id OR s.image_asset_id=OLD.asset_id) OR EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=NEW.asset_id OR s.image_asset_id=NEW.asset_id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_blob_delete BEFORE DELETE ON asset_blobs
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id WHERE s.audio_asset_id=OLD.asset_id OR s.image_asset_id=OLD.asset_id)
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_asset_ready BEFORE INSERT ON assignments
WHEN EXISTS (WITH RECURSIVE p(id) AS (SELECT NEW.test_version_id UNION SELECT m.test_version_id FROM mock_components m JOIN p ON p.id=m.mock_version_id) SELECT 1 FROM p JOIN sections s ON s.test_version_id=p.id JOIN assets a ON a.id=s.audio_asset_id OR a.id=s.image_asset_id WHERE a.storage_kind='OBJECT_STORAGE' AND NOT EXISTS (SELECT 1 FROM asset_blobs b WHERE b.asset_id=a.id))
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_ASSET_NOT_READY'); END;
-- @trigger
CREATE TRIGGER IF NOT EXISTS assigned_assignment_version_update BEFORE UPDATE OF test_id,test_version_id ON assignments
WHEN OLD.test_id IS NOT NEW.test_id OR OLD.test_version_id IS NOT NEW.test_version_id
BEGIN SELECT RAISE(ABORT, 'ASSIGNED_VERSION_IMMUTABLE'); END;
-- @trigger
