-- =============================================================================
-- Learn: coins, the shop, daily quests and sentence translations.
--
-- The learning path pays XP; XP measures progress but cannot be spent, so there
-- was never a reason to come back on a bad day and nothing to do with a good
-- one. This migration adds the second currency and the shelf it buys from.
--
--   * `learn_profiles.coins` is the wallet. It lives on the profile row so the
--     overview, the finish screen and the shop all read one number.
--   * `learn_profiles.xp_boost_until` is an ISO instant: while it is in the
--     future every XP award is doubled. An expired value is ignored rather than
--     cleared, which keeps the read path write-free.
--   * `learn_inventory` is what the learner holds, one row per item. `item_key`
--     is deliberately NOT constrained by a CHECK: the shop's catalogue lives in
--     `src/shared/shop.ts` and is validated in code, so a new item does not
--     need a table rebuild — the failure mode this avoids is exactly the one
--     migration 0012 had to fix for `learn_lessons.kind`.
--   * `learn_shop_orders` and `learn_coin_log` are the audit trail: every coin
--     in and out is one row, so a balance can always be explained (and a bug in
--     the economy is visible rather than mysterious).
--   * `learn_quest_rewards` is keyed (user, day, quest), which is what makes
--     paying a daily quest idempotent: two overviews at the same moment cannot
--     pay twice.
--   * `learn_translations` caches a Vietnamese rendering per English sentence.
--     The built-in lessons are the same sentences for every learner, so the
--     first reader pays for the translation and everyone after them reads it.
-- =============================================================================

ALTER TABLE learn_profiles ADD COLUMN coins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learn_profiles ADD COLUMN xp_boost_until TEXT NOT NULL DEFAULT '';

CREATE TABLE learn_inventory (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_key)
);
CREATE INDEX idx_learn_inventory_user ON learn_inventory (user_id);

CREATE TABLE learn_shop_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_key      TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_price    INTEGER NOT NULL,
  coins_spent   INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_learn_orders_user ON learn_shop_orders (user_id, created_at);

CREATE TABLE learn_coin_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL DEFAULT '',
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_learn_coin_user ON learn_coin_log (user_id, day);

CREATE TABLE learn_quest_rewards (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  quest      TEXT NOT NULL,
  coins      INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, quest)
);

CREATE TABLE learn_translations (
  hash       TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  vi         TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'AI' CHECK (source IN ('AI')),
  created_at TEXT NOT NULL
);
