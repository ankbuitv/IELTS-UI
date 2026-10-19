/**
 * Seasons: fixed eight-week windows that give the league boards and the season
 * pass a shared finish line.
 *
 * A season is derived from the calendar rather than stored in a table: every
 * learner, every board and the Worker computing a claim all agree on which
 * season a date belongs to without a migration or a cron job. The epoch is a
 * Monday so a season starts on a Monday, which keeps "this week" and "this
 * season" aligned.
 *
 * Season XP is read from `learn_xp_log`, the same ledger the weekly board uses,
 * so the pass cannot drift from the work that earned it.
 */
import type { ShopItemKey } from './shop';

/** First day of season 1 (a Monday). Seasons are counted from here. */
export const SEASON_EPOCH_DAY = '2026-10-12';
/** Eight weeks, so a season ends on a Sunday. */
export const SEASON_DAYS = 56;

const MS_PER_DAY = 86_400_000;

export interface SeasonInfo {
  /** Zero-based index; season 1 is index 0. */
  index: number;
  /** Stable key used by claims, e.g. `s3`. */
  key: string;
  /** Human label, e.g. `Season 3`. */
  label: string;
  /** First day, inclusive (`YYYY-MM-DD`). */
  startsOn: string;
  /** Last day, inclusive (`YYYY-MM-DD`). */
  endsOn: string;
  /** Days left including today; never below zero. */
  daysLeft: number;
  totalDays: number;
}

function utcDay(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00.000Z`) / MS_PER_DAY);
}

function isoDay(dayNumber: number): string {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Which season a calendar day belongs to. */
export function seasonOf(day: string): SeasonInfo {
  const today = utcDay(day);
  const index = Math.floor((today - utcDay(SEASON_EPOCH_DAY)) / SEASON_DAYS);
  const startDay = utcDay(SEASON_EPOCH_DAY) + index * SEASON_DAYS;
  const endDay = startDay + SEASON_DAYS - 1;
  return {
    index,
    key: `s${index + 1}`,
    label: `Season ${index + 1}`,
    startsOn: isoDay(startDay),
    endsOn: isoDay(endDay),
    daysLeft: Math.max(0, endDay - today + 1),
    totalDays: SEASON_DAYS,
  };
}

export interface SeasonTier {
  tier: number;
  /** Season XP required to claim. */
  xp: number;
  coins: number;
  /** Optional inventory item granted with the coins. */
  item?: ShopItemKey;
  title: string;
  blurb: string;
}

/**
 * The pass. Rewards are deliberately small and frequent at the start: the
 * first tier should be reachable in a couple of evenings, not after a month.
 */
export const SEASON_TIERS: readonly SeasonTier[] = [
  { tier: 1, xp: 100, coins: 25, title: 'Warm-up', blurb: 'Two lessons and a review.' },
  { tier: 2, xp: 350, coins: 60, item: 'streak_freeze', title: 'Habit', blurb: 'A streak freeze for a busy day.' },
  { tier: 3, xp: 700, coins: 120, title: 'Momentum', blurb: 'A week of steady practice.' },
  { tier: 4, xp: 1200, coins: 200, item: 'xp_boost', title: 'Finisher', blurb: 'An XP boost for the last push.' },
  { tier: 5, xp: 1800, coins: 320, title: 'Season champion', blurb: 'The whole eight weeks, finished.' },
] as const;

export interface SeasonProgressTier extends SeasonTier {
  unlocked: boolean;
  claimed: boolean;
  /** XP still missing for this tier, zero once unlocked. */
  remaining: number;
}

export interface SeasonPassView {
  season: SeasonInfo;
  /** Season XP earned so far. */
  xp: number;
  /** Highest tier reached, zero when none. */
  tier: number;
  /** XP to the next tier, or null at the top. */
  nextXp: number | null;
  tiers: SeasonProgressTier[];
}

export interface SeasonClaimResult extends SeasonPassView {
  granted: { tier: number; coins: number; item: ShopItemKey | null };
}

/** Where `xp` sits on the pass, given the tiers already claimed. */
export function seasonPassProgress(xp: number, claimedTiers: number[] = []): Omit<SeasonPassView, 'season'> {
  const claimed = new Set(claimedTiers);
  const tiers = SEASON_TIERS.map((tier) => ({
    ...tier,
    unlocked: xp >= tier.xp,
    claimed: claimed.has(tier.tier),
    remaining: Math.max(0, tier.xp - xp),
  }));
  const reached = tiers.filter((tier) => tier.unlocked).length;
  const next = tiers.find((tier) => !tier.unlocked);
  return {
    xp,
    tier: reached,
    nextXp: next ? next.xp : null,
    tiers,
  };
}

/** A tier may only be claimed once, and only after reaching its XP. */
export function canClaimTier(xp: number, claimedTiers: number[], tier: number): boolean {
  const target = SEASON_TIERS.find((item) => item.tier === tier);
  if (!target) return false;
  if (claimedTiers.includes(tier)) return false;
  return xp >= target.xp;
}

/** One-line countdown shared by the league and the pass. */
export function seasonCountdown(season: SeasonInfo): string {
  if (season.daysLeft <= 0) return `${season.label} has finished`;
  if (season.daysLeft === 1) return 'Last day of the season';
  return `${season.daysLeft} days left in ${season.label}`;
}
