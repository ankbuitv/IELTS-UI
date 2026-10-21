/**
 * Study groups and virtual study rooms.
 *
 * Groups are a social layer over the existing friends and classroom data: a
 * learner sees friends, classmates and people chasing the same band, and can
 * start or join a small group. Nothing is broadcast beyond a display name,
 * avatar and XP totals.
 *
 * Rooms run one shared pomodoro clock. The server owns the clock: phase end
 * timestamps are persisted, and every response carries `serverNow`, so a
 * learner who joins mid-block sees the same seconds as everybody else. A room
 * advances automatically when a phase expires; if it has been empty for an
 * hour it falls back to idle rather than looping through phantom sessions.
 */
import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { isAvatarId, type AvatarId } from '../../shared/gamification';
import { weekStartOf } from '../../shared/leaderboard';
import { seasonOf } from '../../shared/season';
import {
  GROUP_CAPACITY,
  GROUP_GOAL_MAX,
  GROUP_NAME_MAX,
  ROOM_BREAK_DEFAULT,
  ROOM_CAPACITY,
  ROOM_FOCUS_DEFAULT,
  ROOM_PRESENCE_SECONDS,
  phaseRemaining,
  normaliseBreakMinutes,
  normaliseRoomMinutes,
  type PomodoroPhase,
  type StudyBuddySuggestion,
  type StudyGroupDetail,
  type StudyGroupMember,
  type StudyGroupSummary,
  type StudyGroupsOverview,
  type StudyRoomDetail,
  type StudyRoomMember,
  type StudyRoomSummary,
  type StudyRoomsOverview,
} from '../../shared/study';

const ONLINE_WINDOW_MS = 5 * 60_000;
const ROOM_STALE_MS = 30 * 60_000;
const ROOM_IDLE_AFTER_MS = 60 * 60_000;
const MAX_PHASE_CATCH_UP = 8;

interface GroupRow {
  id: string;
  name: string;
  goal: string;
  target_band: number;
  owner_id: string;
  owner_name: string;
  member_count: number;
  joined: number;
  is_owner: number;
  created_at: string;
}

interface RoomRow {
  id: string;
  owner_id: string;
  name: string;
  topic: string;
  focus_minutes: number;
  break_minutes: number;
  phase: string;
  phase_started_at: string | null;
  phase_ends_at: string | null;
  season_key: string;
  created_at: string;
  occupants: number;
  host_name: string;
}

function groupSummary(row: GroupRow): StudyGroupSummary {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    targetBand: row.target_band,
    memberCount: row.member_count,
    isOwner: row.is_owner === 1,
    joined: row.joined === 1,
    createdAt: row.created_at,
  };
}

function onlineCutoff(): string {
  return new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
}

async function readGroup(env: Env, userId: string, groupId: string): Promise<GroupRow | null> {
  return env.DB.prepare(
    `SELECT g.id, g.name, g.goal, g.target_band, g.owner_id, g.created_at,
            COALESCE(NULLIF(owner_profile.display_name, ''), owner.username, 'Learner') AS owner_name,
            (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id) AS member_count,
            EXISTS (SELECT 1 FROM study_group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS joined,
            CASE WHEN g.owner_id = ? THEN 1 ELSE 0 END AS is_owner
       FROM study_groups g
       JOIN users owner ON owner.id = g.owner_id
       LEFT JOIN user_profiles owner_profile ON owner_profile.user_id = g.owner_id
      WHERE g.id = ?`,
  )
    .bind(userId, userId, groupId)
    .first<GroupRow>();
}

export async function getStudyGroups(env: Env, userId: string, day: string): Promise<StudyGroupsOverview> {
  const weekStart = weekStartOf(day);
  const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const myBand = await env.DB.prepare(
    "SELECT target_band FROM learn_plans WHERE user_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1",
  )
    .bind(userId)
    .first<{ target_band: number }>();

  const mine = await env.DB.prepare(
    `SELECT g.id, g.name, g.goal, g.target_band, g.owner_id, g.created_at,
            COALESCE(NULLIF(owner_profile.display_name, ''), owner.username, 'Learner') AS owner_name,
            (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id) AS member_count,
            1 AS joined,
            CASE WHEN g.owner_id = ? THEN 1 ELSE 0 END AS is_owner
       FROM study_groups g
       JOIN users owner ON owner.id = g.owner_id
       LEFT JOIN user_profiles owner_profile ON owner_profile.user_id = g.owner_id
       JOIN study_group_members mine ON mine.group_id = g.id AND mine.user_id = ?
      ORDER BY mine.joined_at DESC`,
  )
    .bind(userId, userId)
    .all<GroupRow>();

  const discover = await env.DB.prepare(
    `SELECT g.id, g.name, g.goal, g.target_band, g.owner_id, g.created_at,
            COALESCE(NULLIF(owner_profile.display_name, ''), owner.username, 'Learner') AS owner_name,
            (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id) AS member_count,
            0 AS joined,
            0 AS is_owner
       FROM study_groups g
       JOIN users owner ON owner.id = g.owner_id
       LEFT JOIN user_profiles owner_profile ON owner_profile.user_id = g.owner_id
      WHERE NOT EXISTS (SELECT 1 FROM study_group_members m WHERE m.group_id = g.id AND m.user_id = ?)
        AND (SELECT COUNT(*) FROM study_group_members m WHERE m.group_id = g.id) < ?
      ORDER BY ABS(g.target_band - ?), g.created_at DESC
      LIMIT 20`,
  )
    .bind(userId, GROUP_CAPACITY, myBand?.target_band ?? 6.5)
    .all<GroupRow>();

  const suggestions = await env.DB.prepare(
    `WITH friends AS (
       SELECT CASE WHEN user_low_id = ? THEN user_high_id ELSE user_low_id END AS other
         FROM friendships
        WHERE status = 'ACCEPTED' AND (user_low_id = ? OR user_high_id = ?)
     ), classmates AS (
       SELECT DISTINCT other.user_id AS other
         FROM classroom_members mine
         JOIN classroom_members other ON other.classroom_id = mine.classroom_id AND other.user_id != mine.user_id
        WHERE mine.user_id = ? AND mine.status = 'ACTIVE' AND other.status = 'ACTIVE'
     )
     SELECT u.id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS name,
            up.avatar_id AS avatar_id,
            COALESCE(lp.xp, 0) AS xp_total,
            COALESCE((SELECT SUM(x.xp) FROM learn_xp_log x WHERE x.user_id = u.id AND x.day >= ? AND x.day <= ?), 0) AS weekly_xp,
            (SELECT p.target_band FROM learn_plans p WHERE p.user_id = u.id AND p.status = 'ACTIVE' ORDER BY p.created_at DESC LIMIT 1) AS target_band,
            CASE WHEN u.id IN (SELECT other FROM friends) THEN 'FRIEND'
                 WHEN u.id IN (SELECT other FROM classmates) THEN 'CLASSMATE'
                 ELSE 'SAME_TARGET' END AS relation,
            CASE WHEN EXISTS (
              SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at >= ?
            ) THEN 1 ELSE 0 END AS online
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN learn_profiles lp ON lp.user_id = u.id
      WHERE u.id != ? AND u.status = 'ACTIVE' AND u.role IN ('STUDENT', 'ADMIN')
        AND (u.id IN (SELECT other FROM friends) OR u.id IN (SELECT other FROM classmates)
             OR COALESCE((SELECT p2.target_band FROM learn_plans p2 WHERE p2.user_id = u.id AND p2.status = 'ACTIVE' ORDER BY p2.created_at DESC LIMIT 1), -1) BETWEEN ? AND ?)
      ORDER BY CASE relation WHEN 'FRIEND' THEN 0 WHEN 'CLASSMATE' THEN 1 ELSE 2 END, weekly_xp DESC
      LIMIT 12`,
  )
    .bind(
      userId,
      userId,
      userId,
      userId,
      weekStart,
      weekEnd,
      nowIso(),
      onlineCutoff(),
      userId,
      (myBand?.target_band ?? 6.5) - 0.5,
      (myBand?.target_band ?? 6.5) + 0.5,
    )
    .all<{
      user_id: string;
      name: string;
      avatar_id: string | null;
      xp_total: number;
      weekly_xp: number;
      target_band: number | null;
      relation: string;
      online: number;
    }>();

  return {
    groups: (mine.results ?? []).map(groupSummary),
    discover: (discover.results ?? []).map(groupSummary),
    suggestions: (suggestions.results ?? []).map<StudyBuddySuggestion>((row) => ({
      userId: row.user_id,
      name: row.name,
      avatarId: isAvatarId(row.avatar_id) ? row.avatar_id : ('bo' as AvatarId),
      level: Math.max(1, Math.floor(row.xp_total / 120) + 1),
      targetBand: row.target_band,
      weeklyXp: row.weekly_xp,
      online: row.online === 1,
      relation: row.relation === 'FRIEND' ? 'FRIEND' : row.relation === 'CLASSMATE' ? 'CLASSMATE' : 'SAME_TARGET',
    })),
  };
}

export async function getStudyGroup(env: Env, userId: string, groupId: string): Promise<StudyGroupDetail> {
  const group = await readGroup(env, userId, groupId);
  if (!group) throw ApiError.notFound('That study group does not exist.');
  const weekStart = weekStartOf(new Date().toISOString().slice(0, 10));
  const members = await env.DB.prepare(
    `SELECT m.user_id,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS name,
            up.avatar_id AS avatar_id,
            COALESCE(lp.xp, 0) AS xp_total,
            COALESCE((SELECT SUM(x.xp) FROM learn_xp_log x WHERE x.user_id = m.user_id AND x.day >= ?), 0) AS weekly_xp,
            CASE WHEN EXISTS (
              SELECT 1 FROM sessions s WHERE s.user_id = m.user_id AND s.revoked_at IS NULL AND s.expires_at > ? AND s.last_seen_at >= ?
            ) THEN 1 ELSE 0 END AS online,
            CASE WHEN m.user_id = ? THEN 1 ELSE 0 END AS is_me
       FROM study_group_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles up ON up.user_id = m.user_id
       LEFT JOIN learn_profiles lp ON lp.user_id = m.user_id
      WHERE m.group_id = ?
      ORDER BY weekly_xp DESC, m.joined_at`,
  )
    .bind(weekStart, nowIso(), onlineCutoff(), userId, groupId)
    .all<{
      user_id: string;
      name: string;
      avatar_id: string | null;
      xp_total: number;
      weekly_xp: number;
      online: number;
      is_me: number;
    }>();

  return {
    ...groupSummary(group),
    ownerName: group.owner_name,
    members: (members.results ?? []).map<StudyGroupMember>((row) => ({
      userId: row.user_id,
      name: row.name,
      avatarId: isAvatarId(row.avatar_id) ? row.avatar_id : ('bo' as AvatarId),
      level: Math.max(1, Math.floor(row.xp_total / 120) + 1),
      weeklyXp: row.weekly_xp,
      online: row.online === 1,
      isMe: row.is_me === 1,
    })),
  };
}

export async function createStudyGroup(
  env: Env,
  userId: string,
  input: { name: string; goal: string; targetBand: number },
  day: string,
): Promise<StudyGroupDetail> {
  const name = input.name.trim();
  const goal = input.goal.trim();
  if (name.length < 3 || name.length > GROUP_NAME_MAX) {
    throw ApiError.validation(`Give the group a name between 3 and ${GROUP_NAME_MAX} characters.`);
  }
  if (goal.length > GROUP_GOAL_MAX) throw ApiError.validation(`Keep the goal under ${GROUP_GOAL_MAX} characters.`);
  if (!Number.isFinite(input.targetBand) || input.targetBand < 4 || input.targetBand > 9) {
    throw ApiError.validation('Choose a target band between 4.0 and 9.0.');
  }
  const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM study_groups WHERE owner_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  if ((owned?.n ?? 0) >= 3) throw ApiError.conflict('You already run three groups. Close one before starting another.');

  const id = newId('grp');
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO study_groups (id, name, goal, target_band, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, goal, input.targetBand, userId, now),
    env.DB.prepare('INSERT INTO study_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, userId, now),
  ]);
  void day;
  return getStudyGroup(env, userId, id);
}

export async function joinStudyGroup(env: Env, userId: string, groupId: string): Promise<StudyGroupDetail> {
  const group = await readGroup(env, userId, groupId);
  if (!group) throw ApiError.notFound('That study group does not exist.');
  if (group.member_count >= GROUP_CAPACITY) throw ApiError.conflict('That group is full.');
  await env.DB.prepare('INSERT INTO study_group_members (group_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(groupId, userId, nowIso())
    .run();
  return getStudyGroup(env, userId, groupId);
}

export async function leaveStudyGroup(env: Env, userId: string, groupId: string): Promise<void> {
  const group = await readGroup(env, userId, groupId);
  if (!group) throw ApiError.notFound('That study group does not exist.');
  await env.DB.prepare('DELETE FROM study_group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).run();
  if (group.owner_id === userId) {
    const successor = await env.DB.prepare(
      'SELECT user_id FROM study_group_members WHERE group_id = ? ORDER BY joined_at LIMIT 1',
    )
      .bind(groupId)
      .first<{ user_id: string }>();
    if (successor) {
      await env.DB.prepare('UPDATE study_groups SET owner_id = ? WHERE id = ?').bind(successor.user_id, groupId).run();
    } else {
      await env.DB.prepare('DELETE FROM study_groups WHERE id = ?').bind(groupId).run();
    }
  }
}

// ------------------------------------------------------------------ rooms

interface RoomMemberRow {
  user_id: string;
  name: string;
  avatar_id: string | null;
  xp_total: number;
  last_seen_at: string;
  focus_seconds: number;
  minutes_today: number;
}

function pumpPhase(row: RoomRow, nowMs: number): { phase: PomodoroPhase; startedAt: string | null; endsAt: string | null } {
  const phase = (['IDLE', 'FOCUS', 'BREAK'].includes(row.phase) ? row.phase : 'IDLE') as PomodoroPhase;
  let startedAt = row.phase_started_at;
  let endsAt = row.phase_ends_at;
  let current: PomodoroPhase = phase;
  if (current === 'IDLE' || !endsAt) return { phase: 'IDLE', startedAt: null, endsAt: null };
  if (Date.parse(endsAt) > nowMs) return { phase: current, startedAt, endsAt };
  if (nowMs - Date.parse(endsAt) > ROOM_IDLE_AFTER_MS) {
    return { phase: 'IDLE', startedAt: null, endsAt: null };
  }
  let cursor = Date.parse(endsAt);
  for (let step = 0; step < MAX_PHASE_CATCH_UP; step += 1) {
    const previous: PomodoroPhase = current;
    current = previous === 'FOCUS' ? 'BREAK' : 'FOCUS';
    const minutes = current === 'FOCUS' ? row.focus_minutes : row.break_minutes;
    const end = cursor + minutes * 60_000;
    startedAt = new Date(cursor).toISOString();
    endsAt = new Date(end).toISOString();
    cursor = end;
    if (end > nowMs) break;
  }
  return { phase: current, startedAt, endsAt };
}

async function applyPhase(env: Env, row: RoomRow, nowMs: number): Promise<RoomRow> {
  const next = pumpPhase(row, nowMs);
  if (next.phase === row.phase && next.endsAt === row.phase_ends_at) return row;
  await env.DB.prepare('UPDATE study_rooms SET phase = ?, phase_started_at = ?, phase_ends_at = ? WHERE id = ?')
    .bind(next.phase, next.startedAt, next.endsAt, row.id)
    .run();
  return { ...row, phase: next.phase, phase_started_at: next.startedAt, phase_ends_at: next.endsAt };
}

function roomSummary(row: RoomRow): StudyRoomSummary {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    hostName: row.host_name,
    phase: (['IDLE', 'FOCUS', 'BREAK'].includes(row.phase) ? row.phase : 'IDLE') as PomodoroPhase,
    secondsLeft: phaseRemaining((['IDLE', 'FOCUS', 'BREAK'].includes(row.phase) ? row.phase : 'IDLE') as PomodoroPhase, row.phase_ends_at, Date.now()),
    focusMinutes: row.focus_minutes,
    breakMinutes: row.break_minutes,
    occupants: row.occupants,
    capacity: ROOM_CAPACITY,
    seasonKey: row.season_key,
    createdAt: row.created_at,
  };
}

export async function listStudyRooms(env: Env, userId: string, day: string): Promise<StudyRoomsOverview> {
  const cutoff = onlineCutoff();
  const rows = await env.DB.prepare(
    `SELECT r.id, r.owner_id, r.name, r.topic, r.focus_minutes, r.break_minutes, r.phase,
            r.phase_started_at, r.phase_ends_at, r.season_key, r.created_at,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS host_name,
            (SELECT COUNT(*) FROM study_room_members m WHERE m.room_id = r.id AND m.last_seen_at >= ?) AS occupants
       FROM study_rooms r
       JOIN users u ON u.id = r.owner_id
       LEFT JOIN user_profiles up ON up.user_id = r.owner_id
      WHERE r.closed_at IS NULL
      ORDER BY occupants DESC, r.created_at DESC
      LIMIT 30`,
  )
    .bind(cutoff)
    .all<RoomRow>();
  const rooms = await Promise.all((rows.results ?? []).map((row) => applyPhase(env, row, Date.now())));
  const [minutes, current] = await Promise.all([
    env.DB.prepare('SELECT seconds FROM study_focus_days WHERE user_id = ? AND day = ?')
      .bind(userId, day)
      .first<{ seconds: number }>(),
    env.DB.prepare('SELECT room_id FROM study_room_members WHERE user_id = ? AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 1')
      .bind(userId, cutoff)
      .first<{ room_id: string }>(),
  ]);
  return {
    rooms: rooms.map(roomSummary),
    minutesToday: Math.floor((minutes?.seconds ?? 0) / 60),
    currentRoomId: current?.room_id ?? null,
  };
}

async function readRoomRow(env: Env, roomId: string): Promise<RoomRow | null> {
  return env.DB.prepare(
    `SELECT r.id, r.owner_id, r.name, r.topic, r.focus_minutes, r.break_minutes, r.phase,
            r.phase_started_at, r.phase_ends_at, r.season_key, r.created_at,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS host_name,
            (SELECT COUNT(*) FROM study_room_members m WHERE m.room_id = r.id AND m.last_seen_at >= ?) AS occupants
       FROM study_rooms r
       JOIN users u ON u.id = r.owner_id
       LEFT JOIN user_profiles up ON up.user_id = r.owner_id
      WHERE r.id = ? AND r.closed_at IS NULL`,
  )
    .bind(onlineCutoff(), roomId)
    .first<RoomRow>();
}

export async function getStudyRoom(env: Env, userId: string, roomId: string, day: string): Promise<StudyRoomDetail> {
  const row = await readRoomRow(env, roomId);
  if (!row) throw ApiError.notFound('That study room has closed.');
  const live = await applyPhase(env, row, Date.now());
  const cutoff = onlineCutoff();
  const members = await env.DB.prepare(
    `SELECT m.user_id,
            COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS name,
            up.avatar_id AS avatar_id,
            COALESCE(lp.xp, 0) AS xp_total,
            m.last_seen_at, m.focus_seconds,
            COALESCE((SELECT f.seconds FROM study_focus_days f WHERE f.user_id = m.user_id AND f.day = ?), 0) AS minutes_today
       FROM study_room_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN learn_profiles lp ON lp.user_id = u.id
      WHERE m.room_id = ? AND m.last_seen_at >= ?
      ORDER BY m.joined_at`,
  )
    .bind(day, roomId, cutoff)
    .all<RoomMemberRow>();
  return {
    ...roomSummary(live),
    isHost: live.owner_id === userId,
    serverNow: nowIso(),
    members: (members.results ?? []).map<StudyRoomMember>((member) => ({
      userId: member.user_id,
      name: member.name,
      avatarId: isAvatarId(member.avatar_id) ? member.avatar_id : ('bo' as AvatarId),
      online: true,
      isMe: member.user_id === userId,
      isHost: member.user_id === live.owner_id,
      minutesToday: Math.floor((member.minutes_today ?? 0) / 60),
    })),
  };
}

export async function createStudyRoom(
  env: Env,
  userId: string,
  input: { name: string; topic: string; focusMinutes?: number; breakMinutes?: number },
): Promise<StudyRoomDetail> {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 50) throw ApiError.validation('Give the room a name between 3 and 50 characters.');
  const topic = input.topic.trim().slice(0, 120);
  const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM study_rooms WHERE owner_id = ? AND closed_at IS NULL')
    .bind(userId)
    .first<{ n: number }>();
  if ((owned?.n ?? 0) >= 2) throw ApiError.conflict('You already host two open rooms. Close one first.');
  const id = newId('room');
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO study_rooms (id, owner_id, name, topic, focus_minutes, break_minutes, phase, season_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'IDLE', ?, ?)`,
  )
    .bind(
      id,
      userId,
      name,
      topic,
      normaliseRoomMinutes(input.focusMinutes ?? ROOM_FOCUS_DEFAULT),
      normaliseBreakMinutes(input.breakMinutes ?? ROOM_BREAK_DEFAULT),
      seasonOf(now.slice(0, 10)).key,
      now,
    )
    .run();
  return joinStudyRoom(env, userId, id, now.slice(0, 10));
}

export async function joinStudyRoom(env: Env, userId: string, roomId: string, day: string): Promise<StudyRoomDetail> {
  const row = await readRoomRow(env, roomId);
  if (!row) throw ApiError.notFound('That study room has closed.');
  const cutoff = onlineCutoff();
  const mine = await env.DB.prepare('SELECT 1 AS present FROM study_room_members WHERE room_id = ? AND user_id = ? AND last_seen_at >= ?')
    .bind(roomId, userId, cutoff)
    .first<{ present: number }>();
  if (!mine && row.occupants >= ROOM_CAPACITY) throw ApiError.conflict('That room is full.');
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO study_room_members (room_id, user_id, joined_at, last_seen_at, focus_seconds)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(roomId, userId, now, now)
    .run();
  await env.DB.prepare('DELETE FROM study_room_members WHERE room_id = ? AND last_seen_at < ?')
    .bind(roomId, new Date(Date.now() - ROOM_STALE_MS).toISOString())
    .run();
  return getStudyRoom(env, userId, roomId, day);
}

export async function heartbeatStudyRoom(
  env: Env,
  userId: string,
  roomId: string,
  day: string,
): Promise<StudyRoomDetail> {
  const row = await readRoomRow(env, roomId);
  if (!row) throw ApiError.notFound('That study room has closed.');
  const live = await applyPhase(env, row, Date.now());
  const member = await env.DB.prepare(
    'SELECT last_seen_at, focus_seconds FROM study_room_members WHERE room_id = ? AND user_id = ?',
  )
    .bind(roomId, userId)
    .first<{ last_seen_at: string; focus_seconds: number }>();
  const now = nowIso();
  if (member) {
    const elapsed = Math.max(0, Math.min(120, Math.floor((Date.parse(now) - Date.parse(member.last_seen_at)) / 1000)));
    const earning = live.phase === 'FOCUS' ? elapsed : 0;
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE study_room_members SET last_seen_at = ?, focus_seconds = focus_seconds + ? WHERE room_id = ? AND user_id = ?',
      ).bind(now, earning, roomId, userId),
      env.DB.prepare(
        `INSERT INTO study_focus_days (user_id, day, seconds) VALUES (?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`,
      ).bind(userId, day, earning),
    ]);
  } else {
    await env.DB.prepare(
      'INSERT INTO study_room_members (room_id, user_id, joined_at, last_seen_at, focus_seconds) VALUES (?, ?, ?, ?, 0)',
    )
      .bind(roomId, userId, now, now)
      .run();
  }
  return getStudyRoom(env, userId, roomId, day);
}

export async function setRoomPhase(
  env: Env,
  userId: string,
  roomId: string,
  action: 'start' | 'skip' | 'stop',
  day: string,
): Promise<StudyRoomDetail> {
  const row = await readRoomRow(env, roomId);
  if (!row) throw ApiError.notFound('That study room has closed.');
  if (row.owner_id !== userId) throw ApiError.forbidden('Only the host can run the clock.');
  const now = Date.now();
  const live = pumpPhase(row, now);
  let phase: PomodoroPhase;
  let startedAt: string | null;
  let endsAt: string | null;
  if (action === 'stop') {
    phase = 'IDLE';
    startedAt = null;
    endsAt = null;
  } else {
    phase = action === 'skip' ? (live.phase === 'IDLE' ? 'FOCUS' : live.phase === 'FOCUS' ? 'BREAK' : 'FOCUS') : 'FOCUS';
    const minutes = phase === 'FOCUS' ? row.focus_minutes : row.break_minutes;
    startedAt = new Date(now).toISOString();
    endsAt = new Date(now + minutes * 60_000).toISOString();
  }
  await env.DB.prepare('UPDATE study_rooms SET phase = ?, phase_started_at = ?, phase_ends_at = ? WHERE id = ?')
    .bind(phase, startedAt, endsAt, roomId)
    .run();
  return getStudyRoom(env, userId, roomId, day);
}

export async function leaveStudyRoom(env: Env, userId: string, roomId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM study_room_members WHERE room_id = ? AND user_id = ?').bind(roomId, userId).run();
  const room = await env.DB.prepare('SELECT owner_id FROM study_rooms WHERE id = ? AND closed_at IS NULL')
    .bind(roomId)
    .first<{ owner_id: string }>();
  if (!room || room.owner_id !== userId) return;
  const successor = await env.DB.prepare(
    'SELECT user_id FROM study_room_members WHERE room_id = ? AND last_seen_at >= ? ORDER BY joined_at LIMIT 1',
  )
    .bind(roomId, onlineCutoff())
    .first<{ user_id: string }>();
  if (successor) {
    await env.DB.prepare('UPDATE study_rooms SET owner_id = ? WHERE id = ?').bind(successor.user_id, roomId).run();
  } else {
    await env.DB.prepare('UPDATE study_rooms SET closed_at = ?, phase = \'IDLE\', phase_started_at = NULL, phase_ends_at = NULL WHERE id = ?')
      .bind(nowIso(), roomId)
      .run();
  }
}

export { ROOM_PRESENCE_SECONDS };
