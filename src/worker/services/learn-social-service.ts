import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import {
  achievementsFor,
  isAvatarId,
  isNameEffect,
  isProfileEffect,
  levelForXp,
  unlockedBadgeIds,
  type FriendOverview,
  type FriendSearchResult,
  type GamificationProfile,
  type GamificationStats,
  type NameEffect,
  type PlayerCard,
  type ProfileEffect,
} from '../../shared/gamification';

const ONLINE_WINDOW_MS = 5 * 60_000;
const NAME_EFFECT_ITEMS: Partial<Record<NameEffect, string>> = {
  gold: 'cosmetic_name_gold',
  nebula: 'cosmetic_name_nebula',
};
const PROFILE_EFFECT_ITEMS: Partial<Record<ProfileEffect, string>> = {
  glow: 'cosmetic_profile_glow',
  sparkle: 'cosmetic_profile_sparkle',
};

interface IdentityRow {
  user_id: string;
  display_name: string | null;
  role: 'STUDENT' | 'ADMIN';
  status: string;
  created_at: string;
  avatar_id: string | null;
  name_effect: string | null;
  profile_effect: string | null;
  xp: number;
  streak: number;
  best_streak: number;
}

async function identityRow(env: Env, userId: string): Promise<IdentityRow | null> {
  return env.DB.prepare(
    `SELECT u.id AS user_id, u.role, u.status, u.created_at,
            up.display_name, up.avatar_id, up.name_effect, up.profile_effect,
            COALESCE(lp.xp, 0) AS xp, COALESCE(lp.streak, 0) AS streak,
            COALESCE(lp.best_streak, 0) AS best_streak
       FROM users u
  LEFT JOIN user_profiles up ON up.user_id = u.id
  LEFT JOIN learn_profiles lp ON lp.user_id = u.id
      WHERE u.id = ? AND u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE'`,
  )
    .bind(userId)
    .first<IdentityRow>();
}

async function onlineNow(env: Env, userId: string): Promise<boolean> {
  const now = nowIso();
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    `SELECT MAX(last_seen_at) AS last_seen FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
  )
    .bind(userId, now)
    .first<{ last_seen: string | null }>();
  return Boolean(row?.last_seen && row.last_seen >= since);
}

async function statsFor(env: Env, userId: string, base?: IdentityRow): Promise<GamificationStats> {
  const profile = base ?? await identityRow(env, userId);
  const [lesson, friend, attempts] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS lessons,
              COALESCE(SUM(CASE WHEN best_accuracy >= 0.999 THEN 1 ELSE 0 END), 0) AS perfect
         FROM learn_lessons_done WHERE user_id = ? AND completions > 0`,
    ).bind(userId).first<{ lessons: number; perfect: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM friendships
        WHERE status = 'ACCEPTED' AND (user_low_id = ? OR user_high_id = ?)`,
    ).bind(userId, userId).first<{ count: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM attempts WHERE user_id = ? AND status = 'SUBMITTED'`,
    ).bind(userId).first<{ count: number }>(),
  ]);
  return {
    xp: profile?.xp ?? 0,
    lessons: lesson?.lessons ?? 0,
    perfectLessons: lesson?.perfect ?? 0,
    bestStreak: profile?.best_streak ?? 0,
    friends: friend?.count ?? 0,
    attempts: attempts?.count ?? 0,
  };
}

function cardFrom(row: IdentityRow, online: boolean, stats: GamificationStats): PlayerCard {
  const level = levelForXp(row.xp).level;
  return {
    userId: row.user_id,
    displayName: row.display_name?.trim() || 'Learner',
    role: row.role,
    avatarId: isAvatarId(row.avatar_id) ? row.avatar_id : 'bo',
    nameEffect: isNameEffect(row.name_effect) ? row.name_effect : 'default',
    profileEffect: isProfileEffect(row.profile_effect) ? row.profile_effect : 'none',
    online,
    xp: row.xp,
    level,
    streak: row.streak,
    badgeIds: unlockedBadgeIds(stats),
  };
}

async function playerCard(env: Env, userId: string): Promise<PlayerCard | null> {
  const row = await identityRow(env, userId);
  if (!row) return null;
  const [online, stats] = await Promise.all([onlineNow(env, userId), statsFor(env, userId, row)]);
  return cardFrom(row, online, stats);
}

export async function getGamificationProfile(env: Env, userId: string): Promise<GamificationProfile> {
  const row = await identityRow(env, userId);
  if (!row) throw ApiError.notFound('That player profile does not exist.');
  const [online, stats] = await Promise.all([onlineNow(env, userId), statsFor(env, userId, row)]);
  const card = cardFrom(row, online, stats);
  const level = levelForXp(row.xp);
  return {
    ...card,
    createdAt: row.created_at,
    currentLevelXp: level.currentThreshold,
    nextLevelXp: level.nextThreshold,
    levelProgress: level.progress,
    stats,
    achievements: achievementsFor(stats),
    relationship: 'SELF',
  };
}

async function relationship(
  env: Env,
  userId: string,
  otherId: string,
): Promise<GamificationProfile['relationship']> {
  if (userId === otherId) return 'SELF';
  const low = userId < otherId ? userId : otherId;
  const high = userId < otherId ? otherId : userId;
  const row = await env.DB.prepare(
    'SELECT requested_by, status FROM friendships WHERE user_low_id = ? AND user_high_id = ?',
  )
    .bind(low, high)
    .first<{ requested_by: string; status: string }>();
  if (!row) return 'NONE';
  if (row.status === 'ACCEPTED') return 'FRIEND';
  return row.requested_by === userId ? 'PENDING_OUTGOING' : 'PENDING_INCOMING';
}

export async function getPublicPlayerProfile(env: Env, viewerId: string, targetId: string): Promise<GamificationProfile> {
  const row = await identityRow(env, targetId);
  if (!row) throw ApiError.notFound('That player profile does not exist.');
  const [online, stats, relation] = await Promise.all([
    onlineNow(env, targetId),
    statsFor(env, targetId, row),
    relationship(env, viewerId, targetId),
  ]);
  const card = cardFrom(row, online, stats);
  const level = levelForXp(row.xp);
  return {
    ...card,
    createdAt: row.created_at,
    currentLevelXp: level.currentThreshold,
    nextLevelXp: level.nextThreshold,
    levelProgress: level.progress,
    stats,
    achievements: achievementsFor(stats),
    relationship: relation,
  };
}

export async function updateGamificationIdentity(
  env: Env,
  userId: string,
  input: { avatarId?: string; nameEffect?: string; profileEffect?: string },
): Promise<GamificationProfile> {
  const current = await identityRow(env, userId);
  if (!current) throw ApiError.notFound('That player profile does not exist.');
  const wallet = await env.DB.prepare(
    'SELECT item_key, quantity FROM learn_inventory WHERE user_id = ? AND quantity > 0',
  )
    .bind(userId)
    .all<{ item_key: string; quantity: number }>();
  const owned = new Set((wallet.results ?? []).map((item) => item.item_key));

  if (input.avatarId !== undefined && !isAvatarId(input.avatarId)) throw ApiError.validation('Choose one of the available avatars.');
  if (input.nameEffect !== undefined && !isNameEffect(input.nameEffect)) throw ApiError.validation('That name style does not exist.');
  if (input.profileEffect !== undefined && !isProfileEffect(input.profileEffect)) throw ApiError.validation('That profile effect does not exist.');
  if (input.nameEffect && NAME_EFFECT_ITEMS[input.nameEffect] && !owned.has(NAME_EFFECT_ITEMS[input.nameEffect]!)) {
    throw ApiError.forbidden('Buy that name effect in the Learn shop before equipping it.');
  }
  if (input.profileEffect && PROFILE_EFFECT_ITEMS[input.profileEffect] && !owned.has(PROFILE_EFFECT_ITEMS[input.profileEffect]!)) {
    throw ApiError.forbidden('Buy that profile effect in the Learn shop before equipping it.');
  }

  await env.DB.prepare(
    `UPDATE user_profiles
        SET avatar_id = COALESCE(?, avatar_id),
            name_effect = COALESCE(?, name_effect),
            profile_effect = COALESCE(?, profile_effect),
            updated_at = ?
      WHERE user_id = ?`,
  )
    .bind(input.avatarId ?? null, input.nameEffect ?? null, input.profileEffect ?? null, nowIso(), userId)
    .run();
  return getGamificationProfile(env, userId);
}

async function allRelationships(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT user_low_id, user_high_id, requested_by, status
       FROM friendships WHERE user_low_id = ? OR user_high_id = ?`,
  )
    .bind(userId, userId)
    .all<{ user_low_id: string; user_high_id: string; requested_by: string; status: string }>();
  return rows.results ?? [];
}

function otherParty(row: { user_low_id: string; user_high_id: string }, userId: string): string {
  return row.user_low_id === userId ? row.user_high_id : row.user_low_id;
}

export async function getFriendOverview(env: Env, userId: string): Promise<FriendOverview> {
  await requireFriendableUser(env, userId);
  const rows = await allRelationships(env, userId);
  const players = await Promise.all(rows.map(async (row) => ({ row, card: await playerCard(env, otherParty(row, userId)) })));
  return {
    friends: players.filter(({ row, card }) => row.status === 'ACCEPTED' && card).map(({ card }) => card!),
    incoming: players.filter(({ row, card }) => row.status === 'PENDING' && row.requested_by !== userId && card).map(({ card }) => card!),
    outgoing: players.filter(({ row, card }) => row.status === 'PENDING' && row.requested_by === userId && card).map(({ card }) => card!),
  };
}

export async function searchPlayers(env: Env, userId: string, query: string): Promise<FriendSearchResult[]> {
  await requireFriendableUser(env, userId);
  const clean = query.trim().slice(0, 60);
  if (clean.length < 2) return [];
  const rows = await env.DB.prepare(
    `SELECT u.id AS user_id, u.role, u.status, u.created_at,
            up.display_name, up.avatar_id, up.name_effect, up.profile_effect,
            COALESCE(lp.xp, 0) AS xp, COALESCE(lp.streak, 0) AS streak,
            COALESCE(lp.best_streak, 0) AS best_streak
       FROM users u
  LEFT JOIN user_profiles up ON up.user_id = u.id
  LEFT JOIN learn_profiles lp ON lp.user_id = u.id
      WHERE u.id != ? AND u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE'
        AND INSTR(LOWER(COALESCE(up.display_name, '')), LOWER(?)) > 0
   ORDER BY COALESCE(lp.xp, 0) DESC, up.display_name COLLATE NOCASE
      LIMIT 20`,
  )
    .bind(userId, clean)
    .all<IdentityRow>();

  return Promise.all((rows.results ?? []).map(async (row) => {
    const [online, stats, relation] = await Promise.all([
      onlineNow(env, row.user_id),
      statsFor(env, row.user_id, row),
      relationship(env, userId, row.user_id),
    ]);
    return { player: cardFrom(row, online, stats), relationship: relation };
  }));
}

async function requireFriendableUser(env: Env, userId: string): Promise<void> {
  const row = await identityRow(env, userId);
  if (!row) throw ApiError.notFound('That player could not be found.');
}

export async function sendFriendRequest(env: Env, userId: string, targetId: string): Promise<void> {
  await requireFriendableUser(env, userId);
  if (userId === targetId) throw ApiError.validation('You cannot add yourself as a friend.');
  await requireFriendableUser(env, targetId);
  const low = userId < targetId ? userId : targetId;
  const high = userId < targetId ? targetId : userId;
  const existing = await env.DB.prepare(
    'SELECT requested_by, status FROM friendships WHERE user_low_id = ? AND user_high_id = ?',
  )
    .bind(low, high)
    .first<{ requested_by: string; status: string }>();
  if (existing?.status === 'ACCEPTED') throw ApiError.conflict('You are already friends.');
  if (existing?.status === 'PENDING' && existing.requested_by === userId) throw ApiError.conflict('Your friend request is already waiting.');
  const now = nowIso();
  if (existing?.status === 'PENDING') {
    await env.DB.prepare(
      `UPDATE friendships SET status = 'ACCEPTED', updated_at = ?
        WHERE user_low_id = ? AND user_high_id = ? AND status = 'PENDING'`,
    ).bind(now, low, high).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO friendships (user_low_id, user_high_id, requested_by, status, created_at, updated_at)
     VALUES (?, ?, ?, 'PENDING', ?, ?)`,
  )
    .bind(low, high, userId, now, now)
    .run();
}

export async function acceptFriendRequest(env: Env, userId: string, targetId: string): Promise<void> {
  await requireFriendableUser(env, userId);
  if (userId === targetId) throw ApiError.validation('That request is not valid.');
  const low = userId < targetId ? userId : targetId;
  const high = userId < targetId ? targetId : userId;
  const result = await env.DB.prepare(
    `UPDATE friendships SET status = 'ACCEPTED', updated_at = ?
      WHERE user_low_id = ? AND user_high_id = ? AND status = 'PENDING' AND requested_by != ?`,
  )
    .bind(nowIso(), low, high, userId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw ApiError.notFound('There is no incoming request from that player.');
}

export async function removeFriend(env: Env, userId: string, targetId: string): Promise<void> {
  await requireFriendableUser(env, userId);
  if (userId === targetId) return;
  const low = userId < targetId ? userId : targetId;
  const high = userId < targetId ? targetId : userId;
  await env.DB.prepare('DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?').bind(low, high).run();
}
