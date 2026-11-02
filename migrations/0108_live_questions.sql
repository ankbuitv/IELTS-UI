CREATE TABLE IF NOT EXISTS live_room_questions (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES mentor_sessions(id) ON DELETE CASCADE,
 room_key TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ANSWERED')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_questions_room ON live_room_questions(session_id,room_key,created_at,id);
