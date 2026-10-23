-- Blog: admin/mentor-authored posts readable by everyone; comments from any signed-in user.

-- table: blog_posts
CREATE TABLE IF NOT EXISTS blog_posts (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  excerpt      TEXT NOT NULL DEFAULT '',
  body_md      TEXT NOT NULL DEFAULT '',
  cover_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | PUBLISHED
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts (status, published_at);

-- table: blog_comments
CREATE TABLE IF NOT EXISTS blog_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES blog_posts (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blog_comments_post ON blog_comments (post_id, created_at);

-- table: blog_post_tags (optional lightweight tagging)
CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id TEXT NOT NULL REFERENCES blog_posts (id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
