/** Public, privacy-safe Learn identity shared by the Worker and the client. */

export const AVATARS = [
  { id: 'bo', name: 'Bơ', emoji: '🌱', background: 'mint' },
  { id: 'fox', name: 'Fox', emoji: '🦊', background: 'peach' },
  { id: 'owl', name: 'Owl', emoji: '🦉', background: 'lilac' },
  { id: 'frog', name: 'Frog', emoji: '🐸', background: 'lime' },
  { id: 'cat', name: 'Cat', emoji: '🐱', background: 'rose' },
  { id: 'panda', name: 'Panda', emoji: '🐼', background: 'cloud' },
  { id: 'penguin', name: 'Penguin', emoji: '🐧', background: 'ice' },
  { id: 'bee', name: 'Bee', emoji: '🐝', background: 'honey' },
  { id: 'axolotl', name: 'Axolotl', emoji: '🦎', background: 'water' },
  { id: 'capybara', name: 'Capybara', emoji: '🦫', background: 'sand' },
  { id: 'dragon', name: 'Dragon', emoji: '🐲', background: 'violet' },
  { id: 'otter', name: 'Otter', emoji: '🦦', background: 'sky' },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];
export const AVATAR_IDS: readonly AvatarId[] = AVATARS.map((avatar) => avatar.id);

export const NAME_EFFECTS = ['default', 'gold', 'nebula'] as const;
export type NameEffect = (typeof NAME_EFFECTS)[number];
export const PROFILE_EFFECTS = ['none', 'glow', 'sparkle'] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];

export interface GamificationStats {
  xp: number;
  lessons: number;
  perfectLessons: number;
  bestStreak: number;
  friends: number;
  attempts: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
  target: number;
}

export interface PlayerCard {
  userId: string;
  displayName: string;
  role: 'STUDENT' | 'ADMIN';
  avatarId: AvatarId;
  nameEffect: NameEffect;
  profileEffect: ProfileEffect;
  online: boolean;
  xp: number;
  level: number;
  streak: number;
  badgeIds: string[];
}

export interface ProfileLink {
  label: string;
  url: string;
}

export interface GamificationProfile extends PlayerCard {
  createdAt: string;
  /** Free-text description the player writes about themselves. */
  bio: string;
  /** Personal links (up to five) — platforms the player chooses to share. */
  links: ProfileLink[];
  /** Overall estimated band from submitted attempts, or null when unmarked. */
  bestBand: number | null;
  currentLevelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  stats: GamificationStats;
  achievements: Achievement[];
  relationship: 'SELF' | 'NONE' | 'PENDING_INCOMING' | 'PENDING_OUTGOING' | 'FRIEND';
}

export interface FriendOverview {
  friends: PlayerCard[];
  incoming: PlayerCard[];
  outgoing: PlayerCard[];
}

export interface FriendSearchResult {
  player: PlayerCard;
  relationship: GamificationProfile['relationship'];
}

const ACHIEVEMENT_DEFS = [
  { id: 'first_lesson', name: 'First steps', description: 'Finish your first Learn lesson.', icon: '🌟', metric: 'lessons', target: 1 },
  { id: 'perfect_lesson', name: 'Flawless', description: 'Finish a lesson with every answer right first time.', icon: '💎', metric: 'perfectLessons', target: 1 },
  { id: 'streak_7', name: 'Week on fire', description: 'Build a seven-day study streak.', icon: '🔥', metric: 'bestStreak', target: 7 },
  { id: 'lessons_25', name: 'Pathfinder', description: 'Finish 25 Learn lessons.', icon: '🧭', metric: 'lessons', target: 25 },
  { id: 'xp_1000', name: 'XP collector', description: 'Earn 1,000 experience points.', icon: '⚡', metric: 'xp', target: 1_000 },
  { id: 'friends_3', name: 'Study circle', description: 'Add three friends.', icon: '🤝', metric: 'friends', target: 3 },
  { id: 'tests_3', name: 'Test taker', description: 'Submit three practice tests.', icon: '📝', metric: 'attempts', target: 3 },
  { id: 'tests_10', name: 'Regular', description: 'Submit ten practice tests.', icon: '📚', metric: 'attempts', target: 10 },
  { id: 'tests_25', name: 'Veteran', description: 'Submit 25 practice tests.', icon: '🏛️', metric: 'attempts', target: 25 },
  { id: 'tests_50', name: 'Iron will', description: 'Submit 50 practice tests.', icon: '🛡️', metric: 'attempts', target: 50 },
  { id: 'lessons_50', name: 'Explorer', description: 'Finish 50 Learn lessons.', icon: '🗺️', metric: 'lessons', target: 50 },
  { id: 'lessons_100', name: 'Centurion', description: 'Finish 100 Learn lessons.', icon: '🏰', metric: 'lessons', target: 100 },
  { id: 'xp_500', name: 'Collector', description: 'Earn 500 experience points.', icon: '🪙', metric: 'xp', target: 500 },
  { id: 'xp_5000', name: 'Hoard', description: 'Earn 5,000 experience points.', icon: '💰', metric: 'xp', target: 5_000 },
  { id: 'xp_10000', name: 'Legend', description: 'Earn 10,000 experience points.', icon: '👑', metric: 'xp', target: 10_000 },
  { id: 'streak_14', name: 'Two-week run', description: 'Build a fourteen-day study streak.', icon: '🗓️', metric: 'bestStreak', target: 14 },
  { id: 'streak_30', name: 'Unstoppable', description: 'Build a thirty-day study streak.', icon: '🌋', metric: 'bestStreak', target: 30 },
  { id: 'perfect_5', name: 'Precision', description: 'Finish five flawless lessons.', icon: '🎯', metric: 'perfectLessons', target: 5 },
  { id: 'perfect_10', name: 'Untouchable', description: 'Finish ten flawless lessons.', icon: '🌈', metric: 'perfectLessons', target: 10 },
  { id: 'friends_10', name: 'Popular', description: 'Add ten friends.', icon: '🎈', metric: 'friends', target: 10 },
  { id: 'friends_25', name: 'Community star', description: 'Add 25 friends.', icon: '🌟', metric: 'friends', target: 25 },
] as const;

type AchievementMetric = (typeof ACHIEVEMENT_DEFS)[number]['metric'];

/** Levels grow gradually: level 2 begins at 100 XP, level 3 at 400, level 4 at 900. */
export function xpThresholdForLevel(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  return (safe - 1) ** 2 * 100;
}

export function levelForXp(xp: number): { level: number; currentThreshold: number; nextThreshold: number; progress: number } {
  const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let level = 1;
  while (level < 100 && xpThresholdForLevel(level + 1) <= total) level += 1;
  const currentThreshold = xpThresholdForLevel(level);
  const nextThreshold = xpThresholdForLevel(level + 1);
  return {
    level,
    currentThreshold,
    nextThreshold,
    progress: Math.min(1, Math.max(0, (total - currentThreshold) / Math.max(1, nextThreshold - currentThreshold))),
  };
}

export function achievementsFor(stats: GamificationStats): Achievement[] {
  return ACHIEVEMENT_DEFS.map((definition) => {
    const value = Math.max(0, Math.floor(stats[definition.metric as AchievementMetric] ?? 0));
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      icon: definition.icon,
      unlocked: value >= definition.target,
      progress: Math.min(value, definition.target),
      target: definition.target,
    };
  });
}

export function unlockedBadgeIds(stats: GamificationStats): string[] {
  return achievementsFor(stats).filter((achievement) => achievement.unlocked).map((achievement) => achievement.id);
}

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}

export function isNameEffect(value: unknown): value is NameEffect {
  return typeof value === 'string' && (NAME_EFFECTS as readonly string[]).includes(value);
}

export function isProfileEffect(value: unknown): value is ProfileEffect {
  return typeof value === 'string' && (PROFILE_EFFECTS as readonly string[]).includes(value);
}
