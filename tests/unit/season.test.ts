import { describe, expect, it } from 'vitest';
import {
  SEASON_TIERS,
  canClaimTier,
  seasonCountdown,
  seasonOf,
  seasonPassProgress,
} from '../../src/shared/season';

describe('seasons', () => {
  it('starts season 1 on the epoch Monday', () => {
    const season = seasonOf('2026-10-12');
    expect(season.index).toBe(0);
    expect(season.key).toBe('s1');
    expect(season.label).toBe('Season 1');
    expect(season.startsOn).toBe('2026-10-12');
    expect(season.endsOn).toBe('2026-12-06');
    expect(season.daysLeft).toBe(56);
  });

  it('counts the last day of a season as one day left', () => {
    expect(seasonOf('2026-12-06').daysLeft).toBe(1);
    expect(seasonOf('2026-12-06').key).toBe('s1');
  });

  it('rolls over to season 2 the next day', () => {
    const season = seasonOf('2026-12-07');
    expect(season.index).toBe(1);
    expect(season.key).toBe('s2');
    expect(season.startsOn).toBe('2026-12-07');
    expect(season.endsOn).toBe('2027-01-31');
  });

  it('handles a date before the epoch without crashing', () => {
    const season = seasonOf('2026-09-01');
    expect(season.index).toBeLessThan(0);
    expect(season.startsOn <= '2026-09-01').toBe(true);
    expect(season.endsOn >= '2026-09-01').toBe(true);
  });

  it('reports tier progress and the next threshold', () => {
    const pass = seasonPassProgress(360);
    expect(pass.tier).toBe(2);
    expect(pass.xp).toBe(360);
    expect(pass.nextXp).toBe(700);
    expect(pass.tiers[0]!.unlocked).toBe(true);
    expect(pass.tiers[2]!.unlocked).toBe(false);
    expect(pass.tiers[2]!.remaining).toBe(340);
  });

  it('marks claimed tiers and stops at the top tier', () => {
    const pass = seasonPassProgress(5000, [1, 2]);
    expect(pass.tier).toBe(SEASON_TIERS.length);
    expect(pass.nextXp).toBeNull();
    expect(pass.tiers[0]!.claimed).toBe(true);
    expect(pass.tiers[1]!.claimed).toBe(true);
    expect(pass.tiers[2]!.claimed).toBe(false);
  });

  it('only allows an unclaimed, reached tier to be claimed', () => {
    expect(canClaimTier(50, [], 1)).toBe(false);
    expect(canClaimTier(100, [], 1)).toBe(true);
    expect(canClaimTier(100, [1], 1)).toBe(false);
    expect(canClaimTier(100, [], 99)).toBe(false);
  });

  it('writes a one-line countdown', () => {
    expect(seasonCountdown({ ...seasonOf('2026-10-13'), daysLeft: 1 })).toContain('Last day');
    expect(seasonCountdown({ ...seasonOf('2026-10-13'), daysLeft: 5 })).toBe('5 days left in Season 1');
    expect(seasonCountdown({ ...seasonOf('2026-10-13'), daysLeft: 0 })).toContain('finished');
  });
});
