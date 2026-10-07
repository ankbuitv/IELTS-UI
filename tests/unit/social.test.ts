import { describe, expect, it } from 'vitest';
import { SHOP_ITEMS, COSMETIC_ITEM_KEYS } from '../../src/shared/shop';
import { achievementProgress, levelProgress, PROFILE_COSMETIC_UNLOCKS } from '../../src/shared/social';

describe('public profile progression', () => {
  it('turns lifetime XP into a cumulative level and a 250 XP progress bar', () => {
    expect(levelProgress(0)).toEqual({ level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 250, progress: 0 });
    expect(levelProgress(249)).toMatchObject({ level: 1, xpIntoLevel: 249, progress: 99 });
    expect(levelProgress(250)).toMatchObject({ level: 2, xpIntoLevel: 0, progress: 0 });
    expect(levelProgress(-12)).toMatchObject({ level: 1, xp: 0 });
  });

  it('reports progress and only awards earned achievement badges', () => {
    const rows = achievementProgress({ lessons: 10, streak: 6, practiceTests: 5, xp: 999 });
    expect(rows.find((row) => row.id === 'first_lesson')?.unlocked).toBe(true);
    expect(rows.find((row) => row.id === 'lesson_ten')?.unlocked).toBe(true);
    expect(rows.find((row) => row.id === 'streak_seven')).toMatchObject({ progress: 6, target: 7, unlocked: false });
    expect(rows.find((row) => row.id === 'practice_five')?.unlocked).toBe(true);
    expect(rows.find((row) => row.id === 'xp_thousand')).toMatchObject({ progress: 999, target: 1000, unlocked: false });
  });

  it('maps every paid appearance option to a one-time coin-shop cosmetic', () => {
    const cosmetics = SHOP_ITEMS.filter((item) => item.category === 'cosmetic');
    expect(cosmetics.map((item) => item.key).sort()).toEqual([...COSMETIC_ITEM_KEYS].sort());
    expect(cosmetics.every((item) => item.maxOwned === 1 && item.price > 0 && item.price <= 100)).toBe(true);
    expect(new Set(Object.values(PROFILE_COSMETIC_UNLOCKS))).toEqual(new Set(COSMETIC_ITEM_KEYS));
  });
});
