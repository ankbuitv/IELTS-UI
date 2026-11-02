CREATE TABLE IF NOT EXISTS classroom_mention_guards (
 message_id TEXT PRIMARY KEY REFERENCES classroom_messages(id) ON DELETE CASCADE,
 expected_count INTEGER NOT NULL,
 verified_count INTEGER NOT NULL CHECK(expected_count=verified_count)
);
CREATE TABLE IF NOT EXISTS classroom_message_mentions (
 message_id TEXT NOT NULL REFERENCES classroom_messages(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL,
 PRIMARY KEY(message_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_classroom_mentions_user ON classroom_message_mentions(user_id,message_id);
