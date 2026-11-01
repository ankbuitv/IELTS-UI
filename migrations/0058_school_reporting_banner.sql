-- Explicit affiliation: a class is linked to at most one approved school.
CREATE TABLE IF NOT EXISTS school_classroom_links (
  classroom_id TEXT PRIMARY KEY REFERENCES classrooms(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  linked_by TEXT NOT NULL REFERENCES users(id),
  linked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_classroom_links_school ON school_classroom_links(school_id);
CREATE TABLE IF NOT EXISTS school_banners (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL CHECK(theme IN ('blue','green','amber')),
  image_mime TEXT,
  image_b64 TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
