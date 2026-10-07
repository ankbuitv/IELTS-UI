/** The public learning and practice leaderboards. */
import type { Env } from '../env';
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
import { achievementProgress, levelProgress } from '../../shared/social';

/** All-time bounds, so the same SQL shape serves both windows. */
const DAY_MIN = '0000-01-01';
const DAY_MAX = '9999-12-31';
const INSTANT_MIN = '0000-01-01T00:00:00.000Z';
const INSTANT_MAX = '9999-12-31T23:59:59.999Z';
/** Admins may opt into the learning boards; suspended users never appear. */
const VISIBLE_ROLES = "('STUDENT', 'ADMIN')";

/** Shared, non-sensitive profile fields for an aggregate row. */
const PUBLIC_PROFILE_COLUMNS = `
  COALESCE(NULLIF(up.avatar_key, ''), 'bo') AS avatar_key,
  COALESCE(NULLIF(up.username_color, ''), 'default') AS username_color,
  COALESCE(NULLIF(up.profile_effect, ''), 'none') AS profile_effect,
  COALESCE(p.xp, 0) AS total_xp,
  COALESCE(p.streak, 0) AS streak,
  (SELECT COUNT(*) FROM learn_lessons_done d WHERE d.user_id = u.id AND d.completions > 0) AS lessons_completed,
  (SELECT COUNT(*) FROM attempts t WHERE t.user_id = u.id AND t.status = 'SUBMITTED') AS practice_tests,
  EXISTS (
    SELECT 1 FROM sessions s
     WHERE s.user_id = u.id AND s.revoked_at IS NULL
       AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       AND s.last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
  ) AS online`;

interface PublicFields {
  user_id: string;
  name: string;
  avatar_key: string;
  username_color: string;
  profile_effect: string;
  total_xp: number;
  streak: number;
  lessons_completed: number;
  practice_tests: number;
  online: number;
}
interface LearnRow extends PublicFields {
  value: number;
}
interface PracticeRow extends PublicFields {
  value: number;
  best_band: number | null;
}

function publicBadges(row: PublicFields): string[] {
  return achievementProgress({
    lessons: row.lessons_completed,
    streak: row.streak,
    practiceTests: row.practice_tests,
    xp: row.total_xp,
  })
    .filter((badge) => badge.unlocked)
    .map((badge) => badge.name)
    .slice(0, 2);
}

function profileFields(row: PublicFields) {
  const avatarKey = row.avatar_key === 'muc' || row.avatar_key === 'sen' ? row.avatar_key : 'bo';
  const usernameColor = row.username_color === 'sunset' || row.username_color === 'ocean' ? row.username_color : 'default';
  const profileEffect = row.profile_effect === 'glow' ? 'glow' : 'none';
  return {
    userId: row.user_id,
    avatarKey,
    usernameColor,
    profileEffect,
    online: row.online === 1,
    level: levelProgress(row.total_xp).level,
    badges: publicBadges(row),
  } as const;
}

function learnRow(row: LearnRow, rank: number, meId: string): LeaderboardRow {
  const streak = row.streak > 0 ? `${row.streak} day streak` : 'No streak yet';
  return {
    rank,
    ...profileFields(row),
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatXp(row.value),
    secondary: streak,
  };
}

function practiceRow(row: PracticeRow, rank: number, meId: string): LeaderboardRow {
  return {
    rank,
    ...profileFields(row),
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatAttempts(row.value),
    secondary: row.best_band === null ? 'Not marked yet' : `Best band ${row.best_band.toFixed(1)}`,
  };
}

/**
 * The board, plus the reader's own row. A week begins Monday in the local
 * calendar date supplied by the client; submitted-at instants use UTC bounds.
 */
export async function getLeaderboard(
  env: Env,
  userId: string,
  scope: LeaderboardScope,
  window: LeaderboardWindow,
  day: string,
): Promise<LeaderboardResponse> {
  const weekStart = window === 'week' ? weekStartOf(day) : null;
  const weekEnd = weekStart ? new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000) : null;
  const dayFrom = weekStart ?? DAY_MIN;
  const dayTo = weekEnd ? new Date(weekEnd.getTime() - 86_400_000).toISOString().slice(0, 10) : DAY_MAX;
  const instantFrom = weekStart ? `${weekStart}T00:00:00.000Z` : INSTANT_MIN;
  const instantTo = weekEnd ? new Date(weekEnd.getTime() - 1).toISOString() : INSTANT_MAX;

  if (scope === 'learn') {
    const sql = `SELECT p.user_id AS user_id,
                        COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
                        ${window === 'all' ? 'p.xp' : 'COALESCE(SUM(l.xp), 0)'} AS value,
                        ${PUBLIC_PROFILE_COLUMNS}
                   FROM learn_profiles p
                   JOIN users u ON u.id = p.user_id
              LEFT JOIN user_profiles up ON up.user_id = p.user_id
              LEFT JOIN learn_xp_log l ON l.user_id = p.user_id AND l.day >= ? AND l.day <= ?
                  WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE'
               GROUP BY p.user_id
                 HAVING value > 0
               ORDER BY value DESC, streak DESC, p.user_id
                  LIMIT ?`;
    const rows = await env.DB.prepare(sql)
      .bind(dayFrom, dayTo, LEADERBOARD_LIMIT)
      .all<LearnRow>();

    const meRow = await env.DB.prepare(
      `SELECT p.user_id AS user_id,
              COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
              ${window === 'all' ? 'p.xp' : 'COALESCE(SUM(l.xp), 0)'} AS value,
              ${PUBLIC_PROFILE_COLUMNS}
         FROM learn_profiles p
         JOIN users u ON u.id = p.user_id
    LEFT JOIN user_profiles up ON up.user_id = p.user_id
    LEFT JOIN learn_xp_log l ON l.user_id = p.user_id AND l.day >= ? AND l.day <= ?
        WHERE p.user_id = ? AND u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE'
     GROUP BY p.user_id`,
    )
      .bind(dayFrom, dayTo, userId)
      .first<LearnRow>();

    const ahead = meRow
      ? await env.DB.prepare(
          window === 'all'
            ? `SELECT COUNT(*) AS ahead
                 FROM learn_profiles p JOIN users u ON u.id = p.user_id
                WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND p.xp > ?`
            : `SELECT COUNT(*) AS ahead FROM (
                 SELECT l.user_id AS user_id, SUM(l.xp) AS value
                   FROM learn_xp_log l JOIN users u ON u.id = l.user_id
                  WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND l.day >= ? AND l.day <= ?
                  GROUP BY l.user_id HAVING value > ?
               )`,
        )
          .bind(...(window === 'all' ? [meRow.value] : [dayFrom, dayTo, meRow.value]))
          .first<{ ahead: number }>()
      : null;

    const total = await env.DB.prepare(
      window === 'all'
        ? `SELECT COUNT(*) AS total FROM learn_profiles p JOIN users u ON u.id = p.user_id
            WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND p.xp > 0`
        : `SELECT COUNT(*) AS total FROM (
             SELECT l.user_id AS user_id, SUM(l.xp) AS value
               FROM learn_xp_log l JOIN users u ON u.id = l.user_id
              WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND l.day >= ? AND l.day <= ?
              GROUP BY l.user_id HAVING value > 0
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
      valueLabel: 'XP earned',
    };
  }

  const rows = await env.DB.prepare(
    `SELECT a.user_id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
            COUNT(*) AS value,
            MAX(a.estimated_band) AS best_band,
            ${PUBLIC_PROFILE_COLUMNS}
       FROM attempts a
       JOIN users u ON u.id = a.user_id
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
  LEFT JOIN learn_profiles p ON p.user_id = a.user_id
      WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
        AND a.submitted_at >= ? AND a.submitted_at <= ?
   GROUP BY a.user_id
   ORDER BY value DESC, best_band DESC, a.user_id
      LIMIT ?`,
  )
    .bind(instantFrom, instantTo, LEADERBOARD_LIMIT)
    .all<PracticeRow>();

  const meRow = await env.DB.prepare(
    `SELECT a.user_id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
            COUNT(*) AS value,
            MAX(a.estimated_band) AS best_band,
            ${PUBLIC_PROFILE_COLUMNS}
       FROM attempts a
       JOIN users u ON u.id = a.user_id
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
  LEFT JOIN learn_profiles p ON p.user_id = a.user_id
      WHERE a.user_id = ? AND u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
        AND a.submitted_at >= ? AND a.submitted_at <= ?
   GROUP BY a.user_id`,
  )
    .bind(userId, instantFrom, instantTo)
    .first<PracticeRow>();

  const ahead = meRow
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS ahead FROM (
           SELECT a.user_id AS user_id, COUNT(*) AS value
             FROM attempts a JOIN users u ON u.id = a.user_id
            WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
        WHERE u.role IN ${VISIBLE_ROLES} AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
    valueLabel: window === 'week' ? 'Tests this week' : 'Tests taken',
  };
}
