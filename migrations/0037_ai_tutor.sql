-- AI tutor conversations. The tutor is a chat assistant for questions about
-- IELTS, grammar and study habits. It never produces a band score (the judge
-- pipeline does that) and each conversation belongs to one learner.
CREATE TABLE IF NOT EXISTS tutor_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'New chat',
  focus_skill TEXT NOT NULL DEFAULT 'ANY' CHECK (focus_skill IN ('ANY', 'WRITING', 'SPEAKING', 'READING', 'LISTENING', 'VOCABULARY')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_user ON tutor_conversations (user_id, updated_at);

CREATE TABLE IF NOT EXISTS tutor_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES tutor_conversations (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutor_messages_conversation ON tutor_messages (conversation_id, created_at);
