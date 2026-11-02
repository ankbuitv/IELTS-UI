CREATE TABLE IF NOT EXISTS call_summaries (
 id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES mentor_sessions(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,
 published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_summaries ON call_summaries(session_id,updated_at DESC,id DESC);
