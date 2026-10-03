-- =============================================================================
-- Study plans: a dated route through the catalogue towards a target band.
--
-- The path tells a learner what exists; a plan tells them what to do on
-- Tuesday. A plan is built from what the platform already knows — the bands the
-- learner scored in their recent tests, per skill — plus two things only they
-- know: the band they are aiming for and when the exam is.
--
-- The planner is a pure function (`src/shared/learn-plan.ts`); these tables only
-- store its output so the same day is shown every time the page is opened.
--
--   * one plan is `ACTIVE` per learner at a time; rebuilding archives the old
--     one rather than deleting it, so the history of what was suggested and
--     actually done survives a change of target;
--   * an item points at a lesson by foreign key with `ON DELETE SET NULL`, so
--     archiving a lesson empties the slot instead of breaking the plan — the
--     `label` still says what the day was for;
--   * `status` on an item is the learner's own tick. It is not a claim about
--     their ability, only about what they got through.
-- =============================================================================

CREATE TABLE learn_plans (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_band     REAL NOT NULL,
  exam_date       TEXT,
  minutes_per_day INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_learn_plans_user ON learn_plans (user_id, status);

CREATE TABLE learn_plan_items (
  id           TEXT PRIMARY KEY,
  plan_id      TEXT NOT NULL REFERENCES learn_plans (id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  slot         INTEGER NOT NULL DEFAULT 0,
  kind         TEXT NOT NULL CHECK (kind IN ('LESSON', 'REVIEW', 'MOCK_TEST')),
  lesson_id    TEXT REFERENCES learn_lessons (id) ON DELETE SET NULL,
  label        TEXT NOT NULL DEFAULT '',
  band         REAL,
  skill        TEXT CHECK (skill IS NULL OR skill IN ('READING', 'LISTENING', 'WRITING', 'OVERALL')),
  status       TEXT NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'DONE', 'SKIPPED')),
  completed_at TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_learn_plan_items_day ON learn_plan_items (plan_id, day, slot);
