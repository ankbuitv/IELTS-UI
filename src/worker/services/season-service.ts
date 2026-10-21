/**
 * The season pass: XP already earned in the season, and the rewards claimed so
 * far. XP is read from the same ledger the weekly board uses, so the pass never
 * asks a learner to do work twice.
 *
 * Claims are guarded by the primary key `(user_id, season_key, tier)`. The
 * insert is attempted first and only the request that actually inserted a row
 * is allowed to pay out, which makes a double-click harmless.
 */
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { coinStatements } from './learn-shop-service';
import {
  SEASON_TIERS,
  canClaimTier,
  seasonOf,
  seasonPassProgress,
  type SeasonClaimResult,
  type SeasonPassView,
  type SeasonTier,
} from '../../shared/season';

async function seasonXp(env: Env, userId: string, startsOn: string, endsOn: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(xp), 0) AS xp FROM learn_xp_log WHERE user_id = ? AND day >= ? AND day <= ?',
  )
    .bind(userId, startsOn, endsOn)
    .first<{ xp: number }>();
  return row?.xp ?? 0;
}

async function claimedTiers(env: Env, userId: string, seasonKey: string): Promise<number[]> {
  const rows = await env.DB.prepare('SELECT tier FROM learn_season_claims WHERE user_id = ? AND season_key = ?')
    .bind(userId, seasonKey)
    .all<{ tier: number }>();
  return (rows.results ?? []).map((row) => row.tier);
}

export async function getSeasonPass(env: Env, userId: string, day: string): Promise<SeasonPassView> {
  const season = seasonOf(day);
  const [xp, claimed] = await Promise.all([
    seasonXp(env, userId, season.startsOn, season.endsOn),
    claimedTiers(env, userId, season.key),
  ]);
  return { season, ...seasonPassProgress(xp, claimed) };
}

export async function claimSeasonTier(
  env: Env,
  userId: string,
  day: string,
  tierNumber: number,
): Promise<SeasonClaimResult> {
  const season = seasonOf(day);
  const tier: SeasonTier | undefined = SEASON_TIERS.find((item) => item.tier === tierNumber);
  if (!tier) throw ApiError.validation('That reward does not exist.');

  const [xp, claimed] = await Promise.all([
    seasonXp(env, userId, season.startsOn, season.endsOn),
    claimedTiers(env, userId, season.key),
  ]);
  if (!canClaimTier(xp, claimed, tier.tier)) {
    throw ApiError.conflict(
      claimed.includes(tier.tier)
        ? 'That reward has already been claimed.'
        : `You need ${tier.xp - xp} more season XP for that reward.`,
    );
  }

  const now = nowIso();
  const insert = await env.DB.prepare(
    `INSERT INTO learn_season_claims (user_id, season_key, tier, coins, item_key, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, season_key, tier) DO NOTHING`,
  )
    .bind(userId, season.key, tier.tier, tier.coins, tier.item ?? null, now)
    .run();
  if ((insert.meta.changes ?? 0) === 0) {
    throw ApiError.conflict('That reward has already been claimed.');
  }

  await env.DB.prepare(
    `INSERT INTO learn_profiles (user_id, xp, streak, best_streak, daily_goal_xp, created_at, updated_at)
     VALUES (?, 0, 0, 0, 30, ?, ?)
     ON CONFLICT (user_id) DO NOTHING`,
  )
    .bind(userId, now, now)
    .run();

  const statements = coinStatements(env, {
    userId,
    day,
    delta: tier.coins,
    reason: `Season ${season.key} tier ${tier.tier}`,
    now,
  });
  if (tier.item) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO learn_inventory (user_id, item_key, quantity, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT (user_id, item_key) DO UPDATE SET quantity = quantity + 1, updated_at = excluded.updated_at`,
      ).bind(userId, tier.item, now),
    );
  }
  await env.DB.batch(statements);

  const updated = await getSeasonPass(env, userId, day);
  return { ...updated, granted: { tier: tier.tier, coins: tier.coins, item: tier.item ?? null } };
}
