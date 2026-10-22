-- 0041: cover thumbnail for the test library.
--
-- Imported / outside tests show a picture on the learner's library card so a
-- list of titles is scannable. NULL keeps every existing test card unchanged.

ALTER TABLE tests ADD COLUMN cover_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL;
