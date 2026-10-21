-- Speaking: sessions may carry a full custom topic snapshot (AI-generated
-- "random topic" practice). Existing rows keep resolving from topic_set_id.
ALTER TABLE speaking_sessions ADD COLUMN topic_json TEXT;
