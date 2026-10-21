-- ---------------------------------------------------------------------------
-- 0034 — chat follows the breakout room
--
-- Breakout rooms already isolate presence, signalling and the whiteboard. Chat
-- stayed session-wide, so a private room's messages were visible in the main
-- call. Every message now carries the room it was written in (`main` for the
-- plenary), and room state only returns messages from the viewer's room.
-- ---------------------------------------------------------------------------

ALTER TABLE mentor_messages ADD COLUMN room_key TEXT NOT NULL DEFAULT 'main';
CREATE INDEX idx_mentor_messages_room ON mentor_messages (session_id, room_key, created_at);
