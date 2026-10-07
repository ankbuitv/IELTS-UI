/**
 * The Learn shop, the coin economy and the daily quests.
 *
 * Everything here is pure so the Worker and the browser agree on a price, on
 * what an item does and on how many coins a lesson pays — the client shows the
 * number, the server is the one that moves it. Nothing in this module touches
 * the database.
 *
 * Coins are earned by learning (a lesson, a review, a daily quest, the first
 * activity of a day) and are spent on four consumables:
 *
 *   streak_freeze  keeps a streak alive across one missed day
 *   xp_boost       doubles every XP award for a short window
 *   heart_refill   gives the lesson three more hearts after a wipe-out
 *   hint           removes two wrong options (or reveals a letter)
 *
 * Prices are cheapest-first on purpose: a hint and a refill are everyday help,
 * a freeze is insurance against losing weeks of work, and it should hurt a
 * little to buy.
 */

export const SHOP_ITEM_KEYS = [
  'streak_freeze',
  'xp_boost',
  'heart_refill',
  'hint',
  'cosmetic_name_gold',
  'cosmetic_name_nebula',
  'cosmetic_profile_glow',
  'cosmetic_profile_sparkle',
] as const;
export type ShopItemKey = (typeof SHOP_ITEM_KEYS)[number];

export type ShopItemTone = 'ice' | 'sun' | 'rose' | 'violet';

export interface ShopItemDef {
  key: ShopItemKey;
  name: string;
  /** One line for the shelf. */
  tagline: string;
  /** What it actually does, in the player's words. */
  detail: string;
  /** Coins per unit. */
  price: number;
  /** The most a learner may hold at once. */
  maxOwned: number;
  tone: ShopItemTone;
  /**
   * True when the item has a switch the learner flips in the shop (the XP
   * boost). The others are spent where they matter — inside a lesson, or by
   * missing a day — so the shop only sells them, it never uses them.
   */
  manual: boolean;
  /** Cosmetics stay owned and are equipped from the learner profile. */
  cosmetic?: boolean;
}

export const SHOP_ITEMS: readonly ShopItemDef[] = [
  {
    key: 'streak_freeze',
    name: 'Streak freeze',
    tagline: 'A day off without losing your streak',
    detail: 'If you miss a day, one freeze is used automatically and your streak carries on as if you had practised.',
    price: 40,
    maxOwned: 3,
    tone: 'ice',
    manual: false,
  },
  {
    key: 'xp_boost',
    name: 'Double XP',
    tagline: `${doubleXpMinutes()} minutes of double XP`,
    detail: `Every lesson and review pays twice the XP for ${doubleXpMinutes()} minutes after you switch it on.`,
    price: 30,
    maxOwned: 5,
    tone: 'sun',
    manual: true,
  },
  {
    key: 'heart_refill',
    name: 'Heart refill',
    tagline: 'Back to three hearts, keep going',
    detail: 'Use it on the “Out of hearts” screen and the lesson continues where you left off.',
    price: 20,
    maxOwned: 5,
    tone: 'rose',
    manual: false,
  },
  {
    key: 'hint',
    name: 'Hint',
    tagline: 'Halve the choices',
    detail: 'Press the hint button in a lesson: an option question loses two wrong answers, and a typed answer is started for you. One hint, one question.',
    price: 12,
    maxOwned: 9,
    tone: 'violet',
    manual: false,
  },
  {
    key: 'cosmetic_name_gold',
    name: 'Golden name',
    tagline: 'Wear a little gold on the board',
    detail: 'Unlock the gold name treatment for your profile and leaderboard card. Equip it from Profile after buying.',
    price: 80,
    maxOwned: 1,
    tone: 'sun',
    manual: false,
    cosmetic: true,
  },
  {
    key: 'cosmetic_name_nebula',
    name: 'Nebula name',
    tagline: 'A colourful name gradient',
    detail: 'Unlock the nebula gradient for your display name on your profile and the leaderboard.',
    price: 100,
    maxOwned: 1,
    tone: 'violet',
    manual: false,
    cosmetic: true,
  },
  {
    key: 'cosmetic_profile_glow',
    name: 'Profile aura',
    tagline: 'A soft animated profile glow',
    detail: 'Unlock a colourful aura around your avatar and profile card. Equip it from Profile after buying.',
    price: 100,
    maxOwned: 1,
    tone: 'ice',
    manual: false,
    cosmetic: true,
  },
  {
    key: 'cosmetic_profile_sparkle',
    name: 'Starlight frame',
    tagline: 'A bright frame with a little shimmer',
    detail: 'Unlock a starry profile frame for your avatar and profile card. Equip it from Profile after buying.',
    price: 100,
    maxOwned: 1,
    tone: 'rose',
    manual: false,
    cosmetic: true,
  },
];

export function isShopItemKey(value: unknown): value is ShopItemKey {
  return typeof value === 'string' && (SHOP_ITEM_KEYS as readonly string[]).includes(value);
}

export function shopItem(key: ShopItemKey): ShopItemDef {
  const found = SHOP_ITEMS.find((item) => item.key === key);
  // The key type and the list are declared together, so this can only be
  // reached if one of them was changed without the other.
  if (!found) throw new Error(`Unknown shop item: ${key}`);
  return found;
}

/** How long an XP boost lasts. */
export function doubleXpMinutes(): number {
  return 30;
}
export const XP_BOOST_MULTIPLIER = 2;

/** Hearts a refill hands back. */
export const HEART_REFILL_AMOUNT = 3;
/** Wrong options a hint removes (leaving two: the answer and one decoy). */
export const HINT_REMOVES_OPTIONS = 2;

// ------------------------------------------------------------------- coins
/** Coins for finishing a lesson: a base, one per correct answer, a perfect bonus. Repeats pay half. */
export function coinsForLesson(input: { correct: number; total: number; completionsBefore: number }): number {
  const total = Math.max(0, Math.floor(input.total));
  const correct = Math.min(total, Math.max(0, Math.floor(input.correct)));
  const perfect = total > 0 && correct === total;
  const raw = 4 + correct + (perfect ? 4 : 0);
  return input.completionsBefore > 0 ? Math.max(1, Math.round(raw / 2)) : raw;
}

/** Coins for a review session: one per word actually reviewed, plus a clean-sweep bonus. */
export function coinsForReview(reviewed: number, allRight: boolean): number {
  const count = Math.max(0, Math.floor(reviewed));
  return count + (allRight && count > 0 ? 2 : 0);
}

/** Coins handed out the first time a learner does anything on a given day. */
export const DAILY_LOGIN_COINS = 10;

// -------------------------------------------------------------------- boost
/**
 * The multiplier in force at `at`, and when it ends. An expired boost is simply
 * ignored (the row is left alone rather than cleaned up: reading is cheaper than
 * writing, and the next purchase overwrites it).
 */
export function boostState(until: string | null | undefined, at: Date = new Date()): { active: boolean; multiplier: number; minutesLeft: number } {
  if (!until) return { active: false, multiplier: 1, minutesLeft: 0 };
  const end = Date.parse(until);
  if (!Number.isFinite(end) || end <= at.getTime()) return { active: false, multiplier: 1, minutesLeft: 0 };
  return { active: true, multiplier: XP_BOOST_MULTIPLIER, minutesLeft: Math.ceil((end - at.getTime()) / 60_000) };
}

export function boostUntilFrom(at: Date = new Date()): string {
  return new Date(at.getTime() + doubleXpMinutes() * 60_000).toISOString();
}

/** Applies an active boost to a freshly computed award. */
export function applyBoost(xp: number, until: string | null | undefined, at: Date = new Date()): { xp: number; boosted: boolean } {
  const state = boostState(until, at);
  return state.active ? { xp: Math.round(xp * state.multiplier), boosted: true } : { xp, boosted: false };
}

// ------------------------------------------------------------- streak freeze
/**
 * The streak after activity on `today`, allowing for a freeze.
 *
 * Same rules as `nextStreak` in `learn.ts`, with one extra case: a learner who
 * was active the day before yesterday (exactly one missed day) and owns a
 * freeze keeps the streak alive and extends it. Two missed days is not
 * covered — a freeze buys one day, not a holiday.
 */
export function streakWithFreeze(
  previous: { streak: number; lastDay: string | null },
  today: string,
  freezes: number,
): { streak: number; usedFreeze: boolean } {
  const day = (value: string) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
  if (!previous.lastDay) return { streak: 1, usedFreeze: false };
  const gap = day(today) - day(previous.lastDay);
  if (gap <= 0) return { streak: Math.max(1, previous.streak), usedFreeze: false };
  if (gap === 1) return { streak: previous.streak + 1, usedFreeze: false };
  if (gap === 2 && previous.streak > 0 && freezes > 0) return { streak: previous.streak + 1, usedFreeze: true };
  return { streak: 1, usedFreeze: false };
}

// ------------------------------------------------------------------- quests
export type QuestMetric = 'LESSONS' | 'REVIEWS' | 'GOAL';
export type QuestKey = 'lessons2' | 'review1' | 'daily_goal';

export interface QuestDef {
  key: QuestKey;
  label: string;
  /** What has to reach `target` today. */
  metric: QuestMetric;
  target: number;
  coins: number;
}

export const DAILY_QUESTS: readonly QuestDef[] = [
  { key: 'lessons2', label: 'Finish 2 lessons', metric: 'LESSONS', target: 2, coins: 15 },
  { key: 'review1', label: 'Review your notebook', metric: 'REVIEWS', target: 1, coins: 8 },
  { key: 'daily_goal', label: 'Reach your daily XP goal', metric: 'GOAL', target: 1, coins: 10 },
];

/** What today already counts, per metric (0/1 for the goal). */
export interface QuestCounters {
  LESSONS: number;
  REVIEWS: number;
  GOAL: number;
}

export interface QuestView extends QuestDef {
  progress: number;
  /** Coins were paid for this quest today. */
  claimed: boolean;
}

/** One row per quest for the day, ready to render. */
export function questViews(counters: QuestCounters, claimed: readonly string[]): QuestView[] {
  const done = new Set(claimed);
  return DAILY_QUESTS.map((quest) => ({
    ...quest,
    progress: Math.min(quest.target, Math.max(0, counters[quest.metric])),
    claimed: done.has(quest.key),
  }));
}

/** Quests whose target is met today, in definition order. */
export function completedQuests(counters: QuestCounters): QuestDef[] {
  return DAILY_QUESTS.filter((quest) => counters[quest.metric] >= quest.target);
}

/** A shop item as the client sees it: the definition plus what the learner holds. */
export interface ShopItemView extends ShopItemDef {
  owned: number;
  /** True when buying one more is allowed right now (coins and the cap). */
  affordable: boolean;
  /** False at the cap, where the shelf shows "max". */
  canBuyMore: boolean;
}

export interface Wallet {
  coins: number;
  /** ISO instant the double-XP window ends, or null. */
  xpBoostUntil: string | null;
  /** Quantity held per item; missing keys are zero and are not sent. */
  inventory: Partial<Record<ShopItemKey, number>>;
}

export interface ShopState extends Wallet {
  items: ShopItemView[];
  /** Coins earned in total, for the "how to earn" panel. */
  earning: { perLesson: string; perReview: string; dailyBonus: number };
}

export function shopItemViews(wallet: Wallet): ShopItemView[] {
  return SHOP_ITEMS.map((item) => {
    const owned = wallet.inventory[item.key] ?? 0;
    const canBuyMore = owned < item.maxOwned;
    return { ...item, owned, canBuyMore, affordable: canBuyMore && wallet.coins >= item.price };
  });
}
