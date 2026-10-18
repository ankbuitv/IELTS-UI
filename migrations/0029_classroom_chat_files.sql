-- 0029: file attachments in course chat.
--
-- Members can share handouts, essays and images in the classroom stream.
-- Bytes live in `asset_blobs` (delivery via /api/files/:assetId with Range).

ALTER TABLE classroom_messages ADD COLUMN attachment_url TEXT;
ALTER TABLE classroom_messages ADD COLUMN attachment_name TEXT;
