import { describe, expect, it } from 'vitest';
import { AVATARS, NAME_EFFECTS, PROFILE_EFFECTS, achievementsFor, isAvatarId, isNameEffect, isProfileEffect, levelForXp, unlockedBadgeIds } from '../../src/shared/gamification';

describe('player gamification identity', () => {
  it('has original avatar choices and validates purchasable appearance options', () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(AVATARS.map((avatar) => avatar.id)).size).toBe(AVATARS.length);
    expect(NAME_EFFECTS).toContain('gold');
    expect(NAME_EFFECTS).toContain('nebula');
    expect(PROFILE_EFFECTS).toContain('glow');
    expect(PROFILE_EFFECTS).toContain('sparkle');
    expect(isAvatarId('bo')).toBe(true);
    expect(isAvatarId('invented')).toBe(false);
    expect(isNameEffect('nebula')).toBe(true);
    expect(isNameEffect('rainbow')).toBe(false);
    expect(isProfileEffect('sparkle')).toBe(true);
    expect(isProfileEffect('halo')).toBe(false);
  });

  it('levels up at the documented XP thresholds', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100)).toMatchObject({ level: 2, currentThreshold: 100, nextThreshold: 400 });
    expect(levelForXp(400).level).toBe(3);
  });

  it('unlocks achievements from public stats and reports the remaining progress', () => {
    const achievements = achievementsFor({ xp: 1_000, lessons: 25, perfectLessons: 1, bestStreak: 7, friends: 2, attempts: 3 });
    expect(unlockedBadgeIds({ xp: 1_000, lessons: 25, perfectLessons: 1, bestStreak: 7, friends: 2, attempts: 3 })).toEqual(
      ['first_lesson', 'perfect_lesson', 'streak_7', 'lessons_25', 'xp_1000', 'tests_3'],
    );
    expect(achievements.find((item) => item.id === 'friends_3')).toMatchObject({ unlocked: false, progress: 2, target: 3 });
  });
});
