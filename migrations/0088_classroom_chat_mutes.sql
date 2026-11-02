CREATE TABLE IF NOT EXISTS classroom_chat_mutes (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
 muted_until TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,classroom_id)
);
