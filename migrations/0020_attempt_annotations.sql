-- Highlighter and note pad for the exam screen.
-- Marks are anchored to one paragraph of the source text (section + label such as
-- "B") by character offset, so they can be redrawn on resume without storing DOM
-- paths. They belong to the attempt, so a submission freezes them with it and
-- deleting the attempt removes them; nothing is kept about candidates who never
-- annotated anything.

CREATE TABLE attempt_annotations (
  id           TEXT NOT NULL PRIMARY KEY,
  attempt_id   TEXT NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope        TEXT NOT NULL DEFAULT 'PASSAGE' CHECK (scope IN ('PASSAGE')),
  section_id   TEXT NOT NULL,
  anchor       TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset   INTEGER NOT NULL CHECK (end_offset > start_offset),
  excerpt      TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (length(excerpt) <= 800),
  CHECK (note IS NULL OR length(note) <= 800)
);
CREATE INDEX idx_attempt_annotations_attempt ON attempt_annotations (attempt_id, section_id, anchor);
