import type { CosmeticItemKey } from './shop';

/** Locally drawn companion portraits available to every learner. */
export const PROFILE_AVATARS = ['bo', 'muc', 'sen'] as const;
export type ProfileAvatarKey = (typeof PROFILE_AVATARS)[number];

/** Free themes plus themes unlocked from the coin shop. */
export const PROFILE_BANNERS = ['default', 'canopy', 'sky', 'sakura', 'midnight'] as const;
export type ProfileBannerKey = (typeof PROFILE_BANNERS)[number];
export const PROFILE_NAME_COLORS = ['default', 'sunset', 'ocean'] as const;
export type ProfileNameColor = (typeof PROFILE_NAME_COLORS)[number];
export const PROFILE_EFFECTS = ['none', 'glow'] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];

export function isProfileAvatarKey(value: unknown): value is ProfileAvatarKey {
  return typeof value === 'string' && (PROFILE_AVATARS as readonly string[]).includes(value);
}
export function isProfileBannerKey(value: unknown): value is ProfileBannerKey {
  return typeof value === 'string' && (PROFILE_BANNERS as readonly string[]).includes(value);
}
export function isProfileNameColor(value: unknown): value is ProfileNameColor {
  return typeof value === 'string' && (PROFILE_NAME_COLORS as readonly string[]).includes(value);
}
export function isProfileEffect(value: unknown): value is ProfileEffect {
  return typeof value === 'string' && (PROFILE_EFFECTS as readonly string[]).includes(value);
}

/** Shop ownership required for each paid appearance option. */
export const PROFILE_COSMETIC_UNLOCKS: Partial<Record<ProfileBannerKey | ProfileNameColor | ProfileEffect, CosmeticItemKey>> = {
  sakura: 'cosmetic_banner_sakura',
  midnight: 'cosmetic_banner_midnight',
  sunset: 'cosmetic_username_sunset',
  ocean: 'cosmetic_username_ocean',
  glow: 'cosmetic_profile_glow',
};

export interface LevelProgress {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progress: number;
}

/** One level every 250 XP; XP stays cumulative and is never spent. */
export function levelProgress(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  const xpPerLevel = 250;
  const level = Math.floor(total / xpPerLevel) + 1;
  const xpIntoLevel = total % xpPerLevel;
  return {
    level,
    xp: total,
    xpIntoLevel,
    xpForNextLevel: xpPerLevel,
    progress: Math.floor((xpIntoLevel / xpPerLevel) * 100),
  };
}

export interface AchievementProgress {
  id: string;
  name: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

export interface AchievementStats {
  lessons: number;
  streak: number;
  practiceTests: number;
  xp: number;
}

const ACHIEVEMENT_DEFS: ReadonlyArray<{ id: string; name: string; description: string; target: number; value: keyof AchievementStats }> = [
  { id: 'first_lesson', name: 'First step', description: 'Finish your first Learn lesson.', target: 1, value: 'lessons' },
  { id: 'lesson_ten', name: 'Pathfinder', description: 'Finish ten different Learn lessons.', target: 10, value: 'lessons' },
  { id: 'streak_seven', name: 'Seven-day spark', description: 'Build a seven-day learning streak.', target: 7, value: 'streak' },
  { id: 'practice_five', name: 'Test taker', description: 'Submit five practice tests.', target: 5, value: 'practiceTests' },
  { id: 'xp_thousand', name: 'A thousand steps', description: 'Earn 1,000 learning XP.', target: 1000, value: 'xp' },
];

export function achievementProgress(stats: AchievementStats): AchievementProgress[] {
  return ACHIEVEMENT_DEFS.map((definition) => {
    const progress = Math.max(0, Math.min(definition.target, Math.floor(stats[definition.value])));
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      progress,
      target: definition.target,
      unlocked: progress >= definition.target,
    };
  });
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarKey: ProfileAvatarKey;
  bannerKey: ProfileBannerKey;
  usernameColor: ProfileNameColor;
  profileEffect: ProfileEffect;
  online: boolean;
  xp: number;
  level: LevelProgress;
  streak: number;
  lessonsCompleted: number;
  practiceTests: number;
  achievements: AchievementProgress[];
  createdAt: string | null;
  /** Present only for the signed-in user's own profile. */
  ownedCosmetics?: CosmeticItemKey[];
}

export type FriendStatus = 'NONE' | 'FRIENDS' | 'PENDING_SENT' | 'PENDING_RECEIVED';

export interface PersonSummary {
  id: string;
  displayName: string;
  avatarKey: ProfileAvatarKey;
  usernameColor: ProfileNameColor;
  profileEffect: ProfileEffect;
  online: boolean;
  level: number;
  xp: number;
  status?: FriendStatus;
}

export interface FriendRequestView extends PersonSummary {
  requestId: string;
  createdAt: string;
}

export interface FriendsResponse {
  friends: PersonSummary[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
}
