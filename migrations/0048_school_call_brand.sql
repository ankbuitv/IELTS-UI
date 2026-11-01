CREATE TABLE IF NOT EXISTS school_logos (
  school_id TEXT PRIMARY KEY REFERENCES schools(id),
  mime TEXT NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  data_b64 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS school_call_brand (
  session_id TEXT PRIMARY KEY REFERENCES mentor_sessions(id),
  school_id TEXT NOT NULL REFERENCES schools(id),
  selected_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
