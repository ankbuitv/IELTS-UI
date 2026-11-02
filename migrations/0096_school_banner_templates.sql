-- Reusable draft text; saving a template never publishes an announcement.
CREATE TABLE IF NOT EXISTS school_banner_templates (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL CHECK(theme IN ('blue','green','amber')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_school_banner_templates_school ON school_banner_templates(school_id,updated_at DESC,id);
