import { AVATARS, type AvatarId, type NameEffect, type ProfileEffect } from '@shared/gamification';

const BADGE_NAMES: Record<string, string> = {
  first_lesson: 'First steps',
  perfect_lesson: 'Flawless',
  streak_7: 'Week on fire',
  lessons_25: 'Pathfinder',
  xp_1000: 'XP collector',
  friends_3: 'Study circle',
  tests_3: 'Test taker',
};

export function PlayerAvatar({
  avatarId,
  name,
  size = 42,
  effect = 'none',
}: {
  avatarId: AvatarId;
  name: string;
  size?: number;
  effect?: ProfileEffect;
}) {
  const avatar = AVATARS.find((item) => item.id === avatarId) ?? AVATARS[0]!;
  return (
    <span
      className={`player-avatar player-avatar--${avatar.background}${effect !== 'none' ? ` player-avatar--${effect}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(18, Math.round(size * 0.54)) }}
      role="img"
      aria-label={`${name}’s ${avatar.name} avatar`}
    >
      <span aria-hidden="true">{avatar.emoji}</span>
    </span>
  );
}

export function playerNameClass(effect: NameEffect): string {
  return effect === 'default' ? '' : `player-name--${effect}`;
}

export function badgeName(id: string): string {
  return BADGE_NAMES[id] ?? 'Achievement';
}
