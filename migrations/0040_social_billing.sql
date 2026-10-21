-- #31 Subscriptions and orders. Prices live in `shared/billing.ts`; this table
-- records what was actually charged, which provider handled it, and whether an
-- administrator has confirmed a bank transfer.
CREATE TABLE IF NOT EXISTS billing_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('CARD', 'BANK', 'DEMO')),
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'EXPIRED')),
  amount_vnd    INTEGER NOT NULL,
  reference     TEXT NOT NULL UNIQUE,
  checkout_url  TEXT,
  provider_ref  TEXT,
  instructions  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  paid_at       TEXT,
  expires_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_billing_orders_user ON billing_orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_orders_status ON billing_orders (status, created_at);

-- One live subscription per account. A renewal moves `current_period_end`
-- forward; the order history remains the audit trail.
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  plan_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED', 'EXPIRED')),
  provider           TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  order_id           TEXT REFERENCES billing_orders (id) ON DELETE SET NULL
);

-- #46 Season pass: one claim per tier per season. The coins and item granted
-- are copied in, so a later price change cannot rewrite history.
CREATE TABLE IF NOT EXISTS learn_season_claims (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  season_key TEXT NOT NULL,
  tier       INTEGER NOT NULL,
  coins      INTEGER NOT NULL DEFAULT 0,
  item_key   TEXT,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, season_key, tier)
);
CREATE INDEX IF NOT EXISTS idx_season_claims_user ON learn_season_claims (user_id, season_key);

-- #43 Study groups: a persistent small group with a target band and a goal.
CREATE TABLE IF NOT EXISTS study_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  goal        TEXT NOT NULL DEFAULT '',
  target_band REAL NOT NULL,
  owner_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_groups_target ON study_groups (target_band, created_at);

CREATE TABLE IF NOT EXISTS study_group_members (
  group_id  TEXT NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_study_group_members_user ON study_group_members (user_id);

-- #50 Virtual study rooms: one shared pomodoro clock per room. Presence is a
-- heartbeat, and focus seconds are accumulated per participant.
CREATE TABLE IF NOT EXISTS study_rooms (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  topic            TEXT NOT NULL DEFAULT '',
  focus_minutes    INTEGER NOT NULL DEFAULT 25,
  break_minutes    INTEGER NOT NULL DEFAULT 5,
  phase            TEXT NOT NULL DEFAULT 'IDLE' CHECK (phase IN ('IDLE', 'FOCUS', 'BREAK')),
  phase_started_at TEXT,
  phase_ends_at    TEXT,
  season_key       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  closed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_study_rooms_open ON study_rooms (closed_at, created_at);

CREATE TABLE IF NOT EXISTS study_room_members (
  room_id      TEXT NOT NULL REFERENCES study_rooms (id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at    TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  focus_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_study_room_members_user ON study_room_members (user_id, last_seen_at);

-- Minutes today are read from this daily roll-up rather than by summing every
-- room a learner has ever opened.
CREATE TABLE IF NOT EXISTS study_focus_days (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
