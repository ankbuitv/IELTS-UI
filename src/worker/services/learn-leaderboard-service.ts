/**
 * The two leaderboards.
 *
 * Both are read-only aggregations over tables that already exist, and both are
 * scoped to candidates: a teacher's or administrator's account never appears on
 * a learner's board. Names are display names only — no email, no id, nothing
 * that identifies an account beyond the name its owner chose.
 *
 * The design decision worth stating: the Practice board is ranked on submitted
 * attempts, not on band. Ranking by band would reward one lucky paper and make
 * the board useless to the person who is actually working; ranking by attempts
 * measures the thing the board is for (sitting tests), and the best band is
 * shown beside it so volume is never confused with skill.
 */
import type { Env } from '../env';
import { avatarUrlFor } from './auth-service';
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

/** All-time bounds, so the same SQL shape serves both windows. */
const DAY_MIN = '0000-01-01';
const DAY_MAX = '9999-12-31';
const INSTANT_MIN = '0000-01-01T00:00:00.000Z';
const INSTANT_MAX = '9999-12-31T23:59:59.999Z';

interface LearnRow {
  user_id: string;
  name: string;
  value: number;
  streak: number;
  avatar_asset_id?: string | null;
}

interface PracticeRow {
  user_id: string;
  name: string;
  value: number;
  best_band: number | null;
  avatar_asset_id?: string | null;
}

function learnRow(row: LearnRow, rank: number, meId: string): LeaderboardRow {
  const streak = row.streak > 0 ? `${row.streak} day streak` : 'No streak yet';
  return {
    rank,
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatXp(row.value),
    secondary: streak,
    avatarUrl: avatarUrlFor(row.user_id, row.avatar_asset_id),
  };
}

function practiceRow(row: PracticeRow, rank: number, meId: string): LeaderboardRow {
  return {
    rank,
    name: row.name,
    isMe: row.user_id === meId,
    value: row.value,
    valueLabel: formatAttempts(row.value),
    secondary: row.best_band === null ? 'Not marked yet' : `Best band ${row.best_band.toFixed(1)}`,
    avatarUrl: avatarUrlFor(row.user_id, row.avatar_asset_id),
  };
}

/**
 * The board, plus the reader's own row.
 *
 * A week is measured from Monday in the reader's own calendar day (the client
 * sends it), so "this week" starts when their week starts. Attempts carry a UTC
 * instant rather than a local day, so the practice window is cut at midnight
 * UTC on that Monday; an attempt in the first few hours of the local Monday may
 * land in the previous week for a reader far east of UTC. That is a rounding
 * error on a board, not a result.
 */
export async function getLeaderboard(
  env: Env,
  userId: string,
  scope: LeaderboardScope,
  window: LeaderboardWindow,
  day: string,
): Promise<LeaderboardResponse> {
  const weekStart = window === 'week' ? weekStartOf(day) : null;
  // A week runs Monday to Sunday: the bounds are the first instant of Monday
  // and the last millisecond of Sunday.
  const weekEnd = weekStart ? new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000) : null;
  const dayFrom = weekStart ?? DAY_MIN;
  const dayTo = weekEnd ? new Date(weekEnd.getTime() - 86_400_000).toISOString().slice(0, 10) : DAY_MAX;
  const instantFrom = weekStart ? `${weekStart}T00:00:00.000Z` : INSTANT_MIN;
  const instantTo = weekEnd ? new Date(weekEnd.getTime() - 1).toISOString() : INSTANT_MAX;

  if (scope === 'learn') {
    const weeklyValueExpr = `MAX(
      COALESCE(lw.xp_sum, 0),
      COALESCE(ld.xp_sum, 0),
      CASE WHEN p.last_active_day >= ? AND p.last_active_day <= ? THEN p.xp ELSE 0 END
    )`;
    const valueExpr = window === 'all' ? 'MAX(p.xp, COALESCE(ld.xp_sum, 0), COALESCE(lw.xp_sum, 0))' : weeklyValueExpr;
    const subqueries = `
      LEFT JOIN (
        SELECT user_id, SUM(xp) AS xp_sum
          FROM learn_xp_log
         WHERE (day >= ? AND day <= ?) OR (created_at >= ? AND created_at <= ?)
         GROUP BY user_id
      ) lw ON lw.user_id = p.user_id
      LEFT JOIN (
        SELECT user_id, SUM(xp_earned) AS xp_sum
          FROM learn_lessons_done
         WHERE last_completed_at >= ? AND last_completed_at <= ?
         GROUP BY user_id
      ) ld ON ld.user_id = p.user_id`;
    const baseParams =
      window === 'all'
        ? [dayFrom, dayTo, instantFrom, instantTo, instantFrom, instantTo]
        : [dayFrom, dayTo, dayFrom, dayTo, instantFrom, instantTo, instantFrom, instantTo];

    // No role filter on the board: an admin or teacher account testing a
    // lesson on their phone expects to see themselves on the board they just
    // played for, rather than being told they have not finished a lesson.
    const sql = `SELECT p.user_id AS user_id,
                        COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
                        ${valueExpr} AS value,
                        p.streak AS streak,
                        up.avatar_asset_id AS avatar_asset_id
                   FROM learn_profiles p
                   JOIN users u ON u.id = p.user_id
              LEFT JOIN user_profiles up ON up.user_id = p.user_id
              ${subqueries}
                  WHERE u.status = 'ACTIVE'
               GROUP BY p.user_id
                 HAVING value > 0
               ORDER BY value DESC, streak DESC, p.user_id
                  LIMIT ?`;
    const rows = await env.DB.prepare(sql)
      .bind(...baseParams, LEADERBOARD_LIMIT)
      .all<LearnRow>();

    const meRow = await env.DB.prepare(
      `SELECT p.user_id AS user_id,
              COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
              ${valueExpr} AS value,
              p.streak AS streak,
                        up.avatar_asset_id AS avatar_asset_id
         FROM learn_profiles p
         JOIN users u ON u.id = p.user_id
    LEFT JOIN user_profiles up ON up.user_id = p.user_id
    ${subqueries}
        WHERE p.user_id = ? AND u.status = 'ACTIVE'
     GROUP BY p.user_id`,
    )
      .bind(...baseParams, userId)
      .first<LearnRow>();

    // Rank = how many learners are strictly ahead, plus one. Ties share a rank.
    const ahead = meRow && meRow.value > 0
      ? await env.DB.prepare(
          `SELECT COUNT(*) AS ahead FROM (
             SELECT p.user_id AS user_id, ${valueExpr} AS value
               FROM learn_profiles p
               JOIN users u ON u.id = p.user_id
               ${subqueries}
              WHERE u.status = 'ACTIVE'
              GROUP BY p.user_id
             HAVING value > ?
           )`,
        )
          .bind(...baseParams, meRow.value)
          .first<{ ahead: number }>()
      : null;

    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM (
         SELECT p.user_id AS user_id, ${valueExpr} AS value
           FROM learn_profiles p
           JOIN users u ON u.id = p.user_id
           ${subqueries}
          WHERE u.status = 'ACTIVE'
          GROUP BY p.user_id
         HAVING value > 0
       )`,
    )
      .bind(...baseParams)
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

  // Practice: submitted attempts, with the best band as the second fact.
  const rows = await env.DB.prepare(
    `SELECT a.user_id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
            COUNT(*) AS value,
            MAX(a.estimated_band) AS best_band,
            up.avatar_asset_id AS avatar_asset_id
       FROM attempts a
       JOIN users u ON u.id = a.user_id
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
      WHERE u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
            up.avatar_asset_id AS avatar_asset_id
       FROM attempts a
       JOIN users u ON u.id = a.user_id
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
      WHERE a.user_id = ? AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
            WHERE u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
        WHERE u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
