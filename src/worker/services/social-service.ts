import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { isCosmeticItemKey, type CosmeticItemKey } from '../../shared/shop';
import {
  PROFILE_COSMETIC_UNLOCKS,
  achievementProgress,
  isProfileAvatarKey,
  isProfileBannerKey,
  isProfileEffect,
  isProfileNameColor,
  levelProgress,
  type AchievementStats,
  type FriendRequestView,
  type FriendsResponse,
  type FriendStatus,
  type PersonSummary,
  type ProfileAvatarKey,
  type ProfileBannerKey,
  type ProfileEffect,
  type ProfileNameColor,
  type PublicProfile,
} from '../../shared/social';
import { readWallet } from './learn-shop-service';

const ONLINE_WINDOW_MS = 5 * 60_000;
const PROFILE_ROLES = "('STUDENT', 'ADMIN')";

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_key: string | null;
  banner_key: string | null;
  username_color: string | null;
  profile_effect: string | null;
  created_at: string | null;
  xp: number | null;
  streak: number | null;
  lessons_completed: number;
  practice_tests: number;
  online: number;
}

function safeAvatar(value: string | null | undefined): ProfileAvatarKey {
  return isProfileAvatarKey(value) ? value : 'bo';
}
function safeBanner(value: string | null | undefined): ProfileBannerKey {
  return isProfileBannerKey(value) ? value : 'default';
}
function safeNameColor(value: string | null | undefined): ProfileNameColor {
  return isProfileNameColor(value) ? value : 'default';
}
function safeEffect(value: string | null | undefined): ProfileEffect {
  return isProfileEffect(value) ? value : 'none';
}

async function profileRow(env: Env, userId: string): Promise<ProfileRow | null> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  return env.DB.prepare(
    `SELECT u.id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS display_name,
            up.avatar_key, up.banner_key, up.username_color, up.profile_effect,
            u.created_at,
            COALESCE(lp.xp, 0) AS xp,
            COALESCE(lp.streak, 0) AS streak,
            (SELECT COUNT(*) FROM learn_lessons_done d WHERE d.user_id = u.id AND d.completions > 0) AS lessons_completed,
            (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.status = 'SUBMITTED') AS practice_tests,
            EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at >= ?) AS online
       FROM users u
  LEFT JOIN user_profiles up ON up.user_id = u.id
  LEFT JOIN learn_profiles lp ON lp.user_id = u.id
      WHERE u.id = ? AND u.status = 'ACTIVE' AND u.role IN ${PROFILE_ROLES}`,
  )
    .bind(new Date().toISOString(), since, userId)
    .first<ProfileRow>();
}

function statsFor(row: ProfileRow): AchievementStats {
  return {
    lessons: row.lessons_completed,
    streak: row.streak ?? 0,
    practiceTests: row.practice_tests,
    xp: row.xp ?? 0,
  };
}

function personSummary(row: ProfileRow, status?: FriendStatus): PersonSummary {
  return {
    id: row.id,
    displayName: row.display_name || 'Learner',
    avatarKey: safeAvatar(row.avatar_key),
    usernameColor: safeNameColor(row.username_color),
    profileEffect: safeEffect(row.profile_effect),
    online: row.online === 1,
    level: levelProgress(row.xp ?? 0).level,
    xp: row.xp ?? 0,
    ...(status ? { status } : {}),
  };
}

export async function getPublicProfile(env: Env, userId: string, includeOwnedCosmetics = false): Promise<PublicProfile> {
  const row = await profileRow(env, userId);
  if (!row) throw ApiError.notFound('That profile is unavailable.');
  const achievements = achievementProgress(statsFor(row));
  const profile: PublicProfile = {
    id: row.id,
    displayName: row.display_name || 'Learner',
    avatarKey: safeAvatar(row.avatar_key),
    bannerKey: safeBanner(row.banner_key),
    usernameColor: safeNameColor(row.username_color),
    profileEffect: safeEffect(row.profile_effect),
    online: row.online === 1,
    xp: row.xp ?? 0,
    level: levelProgress(row.xp ?? 0),
    streak: row.streak ?? 0,
    lessonsCompleted: row.lessons_completed,
    practiceTests: row.practice_tests,
    achievements,
    createdAt: row.created_at,
  };
  if (includeOwnedCosmetics) {
    const wallet = await readWallet(env, userId);
    profile.ownedCosmetics = Object.entries(wallet.inventory)
      .filter(([key, quantity]) => isCosmeticItemKey(key) && (quantity ?? 0) > 0)
      .map(([key]) => key as CosmeticItemKey);
  }
  return profile;
}

export interface UpdateSocialProfileInput {
  displayName?: string;
  avatarKey?: ProfileAvatarKey;
  bannerKey?: ProfileBannerKey;
  usernameColor?: ProfileNameColor;
  profileEffect?: ProfileEffect;
}

export async function updateSocialProfile(env: Env, userId: string, input: UpdateSocialProfileInput): Promise<void> {
  if (input.displayName !== undefined && !input.displayName.trim()) {
    throw ApiError.validation('Display name cannot be blank.');
  }
  for (const value of [input.bannerKey, input.usernameColor, input.profileEffect]) {
    if (value === undefined) continue;
    const unlock = PROFILE_COSMETIC_UNLOCKS[value];
    if (!unlock) continue;
    const wallet = await readWallet(env, userId);
    if ((wallet.inventory[unlock] ?? 0) < 1) {
      throw ApiError.forbidden('That appearance option is locked. Unlock it in the Learn shop first.');
    }
  }
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE user_profiles
        SET display_name = COALESCE(?, display_name),
            avatar_key = COALESCE(?, avatar_key),
            banner_key = COALESCE(?, banner_key),
            username_color = COALESCE(?, username_color),
            profile_effect = COALESCE(?, profile_effect),
            updated_at = ?
      WHERE user_id = ?`,
  )
    .bind(
      input.displayName?.trim().slice(0, 40) ?? null,
      input.avatarKey ?? null,
      input.bannerKey ?? null,
      input.usernameColor ?? null,
      input.profileEffect ?? null,
      now,
      userId,
    )
    .run();
}

interface FriendRow {
  request_id: string;
  requester_id: string;
  recipient_id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  created_at: string;
  display_name: string | null;
  avatar_key: string | null;
  username_color: string | null;
  profile_effect: string | null;
  xp: number | null;
  online: number;
}

export async function getFriends(env: Env, userId: string): Promise<FriendsResponse> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT f.id AS request_id, f.requester_id, f.recipient_id, f.status, f.created_at,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS display_name,
            up.avatar_key, up.username_color, up.profile_effect,
            COALESCE(lp.xp, 0) AS xp,
            EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = other.id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at >= ?) AS online
       FROM friend_requests f
       JOIN users other ON other.id = CASE WHEN f.requester_id = ? THEN f.recipient_id ELSE f.requester_id END
  LEFT JOIN user_profiles up ON up.user_id = other.id
  LEFT JOIN learn_profiles lp ON lp.user_id = other.id
      WHERE (f.requester_id = ? OR f.recipient_id = ?)
        AND f.status IN ('PENDING', 'ACCEPTED') AND other.status = 'ACTIVE'
        AND other.role IN ${PROFILE_ROLES}
   ORDER BY f.created_at DESC`,
  )
    .bind(new Date().toISOString(), since, userId, userId, userId)
    .all<FriendRow>();

  const result: FriendsResponse = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows.results ?? []) {
    const incoming = row.requester_id !== userId;
    const status: FriendStatus = row.status === 'ACCEPTED' ? 'FRIENDS' : incoming ? 'PENDING_RECEIVED' : 'PENDING_SENT';
    const summary: PersonSummary = {
      id: incoming ? row.requester_id : row.recipient_id,
      displayName: row.display_name || 'Learner',
      avatarKey: safeAvatar(row.avatar_key),
      usernameColor: safeNameColor(row.username_color),
      profileEffect: safeEffect(row.profile_effect),
      online: row.online === 1,
      level: levelProgress(row.xp ?? 0).level,
      xp: row.xp ?? 0,
    };
    if (status === 'FRIENDS') result.friends.push(summary);
    else {
      const request: FriendRequestView = { ...summary, requestId: row.request_id, createdAt: row.created_at };
      if (status === 'PENDING_RECEIVED') result.incoming.push(request);
      else result.outgoing.push(request);
    }
  }
  return result;
}

async function friendStatus(env: Env, userId: string, targetId: string): Promise<FriendStatus> {
  const row = await env.DB.prepare(
    `SELECT
       EXISTS (SELECT 1 FROM friend_requests WHERE status = 'ACCEPTED' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))) AS friends,
       EXISTS (SELECT 1 FROM friend_requests WHERE status = 'PENDING' AND requester_id = ? AND recipient_id = ?) AS sent,
       EXISTS (SELECT 1 FROM friend_requests WHERE status = 'PENDING' AND requester_id = ? AND recipient_id = ?) AS received`,
  )
    .bind(userId, targetId, targetId, userId, userId, targetId, targetId, userId)
    .first<{ friends: number; sent: number; received: number }>();
  if (row?.friends) return 'FRIENDS';
  if (row?.received) return 'PENDING_RECEIVED';
  if (row?.sent) return 'PENDING_SENT';
  return 'NONE';
}

export async function searchPeople(env: Env, userId: string, query: string): Promise<PersonSummary[]> {
  const clean = query.trim().replace(/[%_\\]/g, (character) => `\\${character}`);
  if (clean.length < 2) return [];
  const pattern = `%${clean}%`;
  const found = await env.DB.prepare(
    `SELECT u.id
       FROM users u
       JOIN user_profiles up ON up.user_id = u.id
      WHERE u.id <> ? AND u.status = 'ACTIVE' AND u.role IN ${PROFILE_ROLES}
        AND lower(up.display_name) LIKE lower(?) ESCAPE '\\'
   ORDER BY lower(up.display_name), u.created_at
      LIMIT 20`,
  )
    .bind(userId, pattern)
    .all<{ id: string }>();
  const summaries = await Promise.all(
    (found.results ?? []).map(async ({ id }) => {
      const row = await profileRow(env, id);
      if (!row) return null;
      const status = await friendStatus(env, userId, id);
      return personSummary(row, status);
    }),
  );
  return summaries.filter((person): person is PersonSummary => person !== null).slice(0, 12);
}

export async function sendFriendRequest(env: Env, userId: string, targetId: string): Promise<void> {
  if (userId === targetId) throw ApiError.validation('You cannot add yourself as a friend.');
  const target = await env.DB.prepare(
    `SELECT id FROM users WHERE id = ? AND status = 'ACTIVE' AND role IN ${PROFILE_ROLES}`,
  )
    .bind(targetId)
    .first<{ id: string }>();
  if (!target) throw ApiError.notFound('That learner is unavailable.');

  const existing = await env.DB.prepare(
    `SELECT id, requester_id, recipient_id, status FROM friend_requests
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
      LIMIT 1`,
  )
    .bind(userId, targetId, targetId, userId)
    .first<{ id: string; requester_id: string; recipient_id: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' }>();
  const now = nowIso();
  if (existing?.status === 'ACCEPTED') throw ApiError.conflict('You are already friends.');
  if (existing?.status === 'PENDING') {
    if (existing.requester_id === userId) throw ApiError.conflict('Your friend request is already waiting.');
    await env.DB.prepare("UPDATE friend_requests SET status = 'ACCEPTED', updated_at = ? WHERE id = ? AND status = 'PENDING'")
      .bind(now, existing.id)
      .run();
    return;
  }
  if (existing?.status === 'DECLINED') {
    await env.DB.prepare(
      "UPDATE friend_requests SET requester_id = ?, recipient_id = ?, status = 'PENDING', created_at = ?, updated_at = ? WHERE id = ? AND status = 'DECLINED'",
    )
      .bind(userId, targetId, now, now, existing.id)
      .run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO friend_requests (id, requester_id, recipient_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'PENDING', ?, ?)`,
  )
    .bind(newId('fr'), userId, targetId, now, now)
    .run();
}

export async function respondToFriendRequest(
  env: Env,
  userId: string,
  requestId: string,
  accept: boolean,
): Promise<void> {
  const status = accept ? 'ACCEPTED' : 'DECLINED';
  const result = await env.DB.prepare(
    "UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ? AND recipient_id = ? AND status = 'PENDING'",
  )
    .bind(status, nowIso(), requestId, userId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw ApiError.notFound('That friend request is no longer waiting for you.');
}

export async function removeFriend(env: Env, userId: string, targetId: string): Promise<void> {
  const result = await env.DB.prepare(
    "UPDATE friend_requests SET status = 'DECLINED', updated_at = ? WHERE status = 'ACCEPTED' AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))",
  )
    .bind(nowIso(), userId, targetId, targetId, userId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw ApiError.notFound('That friendship was not found.');
}
