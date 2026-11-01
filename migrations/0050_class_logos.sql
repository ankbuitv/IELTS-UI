CREATE TABLE IF NOT EXISTS class_logos (
  class_type TEXT NOT NULL CHECK(class_type IN ('TEACHER','MENTOR')),
  class_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  data_b64 TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(class_type,class_id)
);
