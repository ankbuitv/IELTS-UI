-- One action plan per learner per ISO week (Monday, UTC). The plan is stored
-- rather than recomputed on every dashboard render so the checkboxes survive a
-- refresh and a completed week does not silently change under the learner.
CREATE TABLE IF NOT EXISTS weekly_action_plans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  plan_json   TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'RULES' CHECK (source IN ('RULES', 'AI')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_user ON weekly_action_plans (user_id, week_start);
