/**
 * Learn and Practice boards with lightweight public profile metadata.
 *
 * Admin accounts may join either board, but teachers remain outside the
 * competition. Presence is an approximate five-minute session heartbeat; only
 * a display name, avatar, level and public achievements are exposed.
 */
import type { Env } from '../env';
import { levelForXp, unlockedBadgeIds, isAvatarId, isNameEffect, isProfileEffect, type GamificationStats } from '../../shared/gamification';
import {
  LEADERBOARD_LIMIT,
  formatAttempts,
  formatXp,
  weekStartOf,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeaderboardScope,
  type LeaderboardWindow,
} from '../../shared/leaderboard';
import { seasonOf } from '../../shared/season';

const DAY_MIN = '0000-01-01';
const DAY_MAX = '9999-12-31';
const INSTANT_MIN = '0000-01-01T00:00:00.000Z';
const INSTANT_MAX = '9999-12-31T23:59:59.999Z';
const ONLINE_WINDOW_MS = 5 * 60_000;
const PROFILE_FIELDS = `
  u.id AS user_id,
  COALESCE(NULLIF(up.display_name, ''), u.username, 'Learner') AS name,
  u.role AS role,
  up.avatar_id AS avatar_id,
  up.name_effect AS name_effect,
  up.profile_effect AS profile_effect,
  CASE WHEN presence.last_seen_at >= ? THEN 1 ELSE 0 END AS online,
  COALESCE(lp.xp, 0) AS xp_total,
  COALESCE(lp.streak, 0) AS streak,
  COALESCE(lp.best_streak, 0) AS best_streak,
  COALESCE((SELECT COUNT(*) FROM learn_lessons_done d WHERE d.user_id = u.id AND d.completions > 0), 0) AS lessons,
  COALESCE((SELECT COUNT(*) FROM learn_lessons_done d WHERE d.user_id = u.id AND d.completions > 0 AND d.best_accuracy >= 0.999), 0) AS perfect_lessons,
  COALESCE((SELECT COUNT(*) FROM friendships f WHERE f.status = 'ACCEPTED' AND (f.user_low_id = u.id OR f.user_high_id = u.id)), 0) AS friends,
  COALESCE((SELECT COUNT(*) FROM attempts at WHERE at.user_id = u.id AND at.status = 'SUBMITTED'), 0) AS attempts,
  (SELECT MAX(atb.estimated_band) FROM attempts atb WHERE atb.user_id = u.id AND atb.status IN ('SUBMITTED', 'EXPIRED') AND atb.estimated_band IS NOT NULL) AS best_band`;
const PROFILE_JOINS = `
  LEFT JOIN user_profiles up ON up.user_id = u.id
  LEFT JOIN learn_profiles lp ON lp.user_id = u.id
  LEFT JOIN (
    SELECT user_id, MAX(last_seen_at) AS last_seen_at
      FROM sessions WHERE revoked_at IS NULL AND expires_at > ?
     GROUP BY user_id
  ) presence ON presence.user_id = u.id`;

interface PlayerFields {
  user_id: string;
  name: string;
  role: 'STUDENT' | 'ADMIN';
  avatar_id: string | null;
  name_effect: string | null;
  profile_effect: string | null;
  online: number;
  xp_total: number;
  streak: number;
  best_streak: number;
  lessons: number;
  perfect_lessons: number;
  friends: number;
  attempts: number;
  best_band: number | null;
}
interface LearnRow extends PlayerFields { value: number }
interface PracticeRow extends PlayerFields { value: number }

function playerFields(row: PlayerFields) {
  const stats: GamificationStats = {
    xp: row.xp_total,
    lessons: row.lessons,
    perfectLessons: row.perfect_lessons,
    bestStreak: row.best_streak,
    friends: row.friends,
    attempts: row.attempts,
  };
  return {
    userId: row.user_id,
    role: row.role,
    avatarId: isAvatarId(row.avatar_id) ? row.avatar_id : 'bo',
    nameEffect: isNameEffect(row.name_effect) ? row.name_effect : 'default',
    profileEffect: isProfileEffect(row.profile_effect) ? row.profile_effect : 'none',
    online: row.online === 1,
    level: levelForXp(row.xp_total).level,
    badgeIds: unlockedBadgeIds(stats),
  } as const;
}

function learnRow(row: LearnRow, rank: number, meId: string): LeaderboardRow {
  return {
    rank,
    ...playerFields(row),
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatXp(row.value),
    secondary: row.streak > 0 ? `${row.streak} day streak` : 'No streak yet',
    bestBand: row.best_band === null ? null : Math.round(row.best_band * 10) / 10,
  };
}

function practiceRow(row: PracticeRow, rank: number, meId: string): LeaderboardRow {
  return {
    rank,
    ...playerFields(row),
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatAttempts(row.value),
    secondary: row.best_band === null ? 'Not marked yet' : `Best band ${row.best_band.toFixed(1)}`,
    bestBand: row.best_band === null ? null : Math.round(row.best_band * 10) / 10,
  };
}

function valueLabelFor(window: LeaderboardWindow): string {
  if (window === 'week') return 'XP this week';
  if (window === 'season') return 'XP this season';
  return 'XP earned';
}

interface ClassroomRef {
  id: string;
  name: string;
}

/**
 * The class a board is for: the requested one when the learner belongs to it,
 * otherwise the first class they teach or attend.
 */
async function resolveClassroom(env: Env, userId: string, classroomId?: string): Promise<ClassroomRef | null> {
  if (classroomId) {
    return env.DB.prepare(
      `SELECT c.id, c.name FROM classrooms c
        WHERE c.id = ? AND c.status = 'ACTIVE'
          AND (c.teacher_id = ? OR EXISTS (
            SELECT 1 FROM classroom_members m WHERE m.classroom_id = c.id AND m.user_id = ? AND m.status = 'ACTIVE'
          ))`,
    )
      .bind(classroomId, userId, userId)
      .first<ClassroomRef>();
  }
  return env.DB.prepare(
    `SELECT DISTINCT c.id, c.name, c.created_at FROM classrooms c
       LEFT JOIN classroom_members m ON m.classroom_id = c.id AND m.user_id = ? AND m.status = 'ACTIVE'
      WHERE c.status = 'ACTIVE' AND (c.teacher_id = ? OR m.user_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1`,
  )
    .bind(userId, userId)
    .first<ClassroomRef>();
}

export async function getLeaderboard(
  env: Env,
  userId: string,
  scope: LeaderboardScope,
  window: LeaderboardWindow,
  day: string,
  options: { classroomId?: string } = {},
): Promise<LeaderboardResponse> {
  const season = seasonOf(day);
  const weekStart = window === 'week' ? weekStartOf(day) : null;
  const rangeStart = window === 'week' ? weekStartOf(day) : window === 'season' ? season.startsOn : null;
  const rangeEnd =
    window === 'week'
      ? new Date(Date.parse(`${weekStartOf(day)}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)
      : window === 'season'
        ? season.endsOn
        : null;
  const dayFrom = rangeStart ?? DAY_MIN;
  const dayTo = rangeEnd ?? DAY_MAX;
  const instantFrom = rangeStart ? `${rangeStart}T00:00:00.000Z` : INSTANT_MIN;
  const instantTo = rangeEnd
    ? new Date(Date.parse(`${rangeEnd}T00:00:00.000Z`) + 86_400_000 - 1).toISOString()
    : INSTANT_MAX;
  const now = new Date().toISOString();
  const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  const roles = "u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE'";

  if (scope === 'class') {
    const classroom = await resolveClassroom(env, userId, options.classroomId);
    if (!classroom) {
      return {
        scope,
        window,
        rows: [],
        me: null,
        total: 0,
        weekStart,
        valueLabel: valueLabelFor(window),
        classroom: null,
        season,
      };
    }
    const valueExpression = window === 'all' ? 'COALESCE(lp.xp, 0)' : 'COALESCE(SUM(x.xp), 0)';
    const rows = await env.DB.prepare(
      `SELECT ${PROFILE_FIELDS}, ${valueExpression} AS value
         FROM users u${PROFILE_JOINS}
         LEFT JOIN learn_xp_log x ON x.user_id = u.id AND x.day >= ? AND x.day <= ?
        WHERE ${roles}
          AND u.id IN (
            SELECT user_id FROM classroom_members WHERE classroom_id = ? AND status = 'ACTIVE'
            UNION SELECT teacher_id FROM classrooms WHERE id = ?
          )
     GROUP BY u.id
       HAVING value > 0
     ORDER BY value DESC, streak DESC, u.id
        LIMIT 500`,
    )
      .bind(onlineCutoff, now, dayFrom, dayTo, classroom.id, classroom.id)
      .all<LearnRow>();
    const mapped = (rows.results ?? []).map((row, index) => learnRow(row, index + 1, userId));
    return {
      scope,
      window,
      rows: mapped.slice(0, LEADERBOARD_LIMIT),
      me: mapped.find((row) => row.isMe) ?? null,
      total: mapped.length,
      weekStart,
      valueLabel: valueLabelFor(window),
      classroom,
      season,
    };
  }

  if (scope === 'learn') {
    const valueExpression = window === 'all' ? 'COALESCE(lp.xp, 0)' : 'COALESCE(SUM(x.xp), 0)';
    const from = `FROM users u${PROFILE_JOINS}
      LEFT JOIN learn_xp_log x ON x.user_id = u.id AND x.day >= ? AND x.day <= ?`;
    const columns = `${PROFILE_FIELDS}, ${valueExpression} AS value`;
    const rows = await env.DB.prepare(
      `SELECT ${columns} ${from}
        WHERE ${roles}
     GROUP BY u.id
       HAVING value > 0
     ORDER BY value DESC, streak DESC, u.id
        LIMIT ?`,
    )
      .bind(onlineCutoff, now, dayFrom, dayTo, LEADERBOARD_LIMIT)
      .all<LearnRow>();

    const meRow = await env.DB.prepare(
      `SELECT ${columns} ${from}
        WHERE u.id = ? AND ${roles}
     GROUP BY u.id`,
    )
      .bind(onlineCutoff, now, dayFrom, dayTo, userId)
      .first<LearnRow>();

    const ahead = meRow
      ? await env.DB.prepare(
          window === 'all'
            ? `SELECT COUNT(*) AS ahead FROM learn_profiles lp JOIN users u ON u.id = lp.user_id
                WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND lp.xp > ?`
            : `SELECT COUNT(*) AS ahead FROM (
                 SELECT x.user_id AS user_id, SUM(x.xp) AS value
                   FROM learn_xp_log x JOIN users u ON u.id = x.user_id
                  WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND x.day >= ? AND x.day <= ?
                  GROUP BY x.user_id HAVING value > ?
               )`,
        )
          .bind(...(window === 'all' ? [meRow.value] : [dayFrom, dayTo, meRow.value]))
          .first<{ ahead: number }>()
      : null;

    const total = await env.DB.prepare(
      window === 'all'
        ? `SELECT COUNT(*) AS total FROM learn_profiles lp JOIN users u ON u.id = lp.user_id
            WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND lp.xp > 0`
        : `SELECT COUNT(*) AS total FROM (
             SELECT x.user_id AS user_id, SUM(x.xp) AS value
               FROM learn_xp_log x JOIN users u ON u.id = x.user_id
              WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND x.day >= ? AND x.day <= ?
              GROUP BY x.user_id HAVING value > 0
           )`,
    )
      .bind(...(window === 'all' ? [] : [dayFrom, dayTo]))
      .first<{ total: number }>();

    return {
      scope,
      window,
      rows: (rows.results ?? []).map((row, index) => learnRow(row, index + 1, userId)),
      me: meRow && meRow.value > 0 ? learnRow(meRow, (ahead?.ahead ?? 0) + 1, userId) : null,
      total: total?.total ?? 0,
      weekStart,
      valueLabel: valueLabelFor(window),
      classroom: null,
      season,
    };
  }

  const attemptsSql = `
    SELECT user_id, COUNT(*) AS value, MAX(estimated_band) AS best_band
      FROM attempts
     WHERE status = 'SUBMITTED' AND submitted_at >= ? AND submitted_at <= ?
  GROUP BY user_id`;
  const boardFrom = `FROM users u${PROFILE_JOINS}
    JOIN (${attemptsSql}) board_attempts ON board_attempts.user_id = u.id`;
  const practiceColumns = `${PROFILE_FIELDS}, board_attempts.value AS value, board_attempts.best_band AS best_band`;
  const rows = await env.DB.prepare(
    `SELECT ${practiceColumns} ${boardFrom}
      WHERE ${roles}
   ORDER BY value DESC, best_band DESC, u.id
      LIMIT ?`,
  )
    .bind(onlineCutoff, now, instantFrom, instantTo, LEADERBOARD_LIMIT)
    .all<PracticeRow>();

  const meRow = await env.DB.prepare(
    `SELECT ${practiceColumns} ${boardFrom}
      WHERE u.id = ? AND ${roles}`,
  )
    .bind(onlineCutoff, now, instantFrom, instantTo, userId)
    .first<PracticeRow>();

  const ahead = meRow
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS ahead FROM (
           SELECT a.user_id AS user_id, COUNT(*) AS value
             FROM attempts a JOIN users u ON u.id = a.user_id
            WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
              AND a.submitted_at >= ? AND a.submitted_at <= ?
            GROUP BY a.user_id HAVING value > ?
         )`,
      )
        .bind(instantFrom, instantTo, meRow.value)
        .first<{ ahead: number }>()
    : null;

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM (
       SELECT a.user_id AS user_id, COUNT(*) AS value
         FROM attempts a JOIN users u ON u.id = a.user_id
        WHERE u.role IN ('STUDENT', 'ADMIN') AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
          AND a.submitted_at >= ? AND a.submitted_at <= ?
        GROUP BY a.user_id HAVING value > 0
     )`,
  )
    .bind(instantFrom, instantTo)
    .first<{ total: number }>();

  return {
    scope,
    window,
    rows: (rows.results ?? []).map((row, index) => practiceRow(row, index + 1, userId)),
    me: meRow ? practiceRow(meRow, (ahead?.ahead ?? 0) + 1, userId) : null,
    total: total?.total ?? 0,
    weekStart,
    valueLabel: window === 'week' ? 'Tests this week' : window === 'season' ? 'Tests this season' : 'Tests taken',
    classroom: null,
    season,
  };
}
