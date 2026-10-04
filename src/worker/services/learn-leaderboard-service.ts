/**
 * The two leaderboards.
 *
 * Both are read-only aggregations over tables that already exist. The *list* is
 * scoped to learner accounts — a teacher's or administrator's name never appears
 * among the class — but the reader's *own* row is not: whoever you are, if you
 * finished a lesson this week you have a total, and the board shows it to you.
 * That distinction is the whole fix for "I just did a lesson and the board says I
 * am not on it": an administrator or a teacher playing the path used to be
 * filtered out of their own board by the same rule that keeps them off everybody
 * else's, and `meEligible` is how the page now tells the two cases apart.
 *
 * Names are display names only — no email, no id, nothing that identifies an
 * account beyond the name its owner chose.
 *
 * The design decision worth stating: the Practice board is ranked on submitted
 * attempts, not on band. Ranking by band would reward one lucky paper and make
 * the board useless to the person who is actually working; ranking by attempts
 * measures the thing the board is for (sitting tests), and the best band is
 * shown beside it so volume is never confused with skill.
 */
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
  avatar: string;
}

interface PracticeRow {
  user_id: string;
  name: string;
  value: number;
  best_band: number | null;
  avatar: string;
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
    avatar: row.avatar ?? '',
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
    avatar: row.avatar ?? '',
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

  /**
   * Whether this account belongs on the competing list at all.
   *
   * Read from the account, never inferred from the presence of a row. The first
   * version of this used `meRow.eligible`, which quietly meant "eligible *and*
   * has done something": a brand-new learner with no XP came back
   * `meEligible: false` and was told this board is for other people's accounts,
   * which is both wrong and the most discouraging thing the page could say to
   * them on their first visit. Now the two questions are separate — `meEligible`
   * answers "could you appear here?", `me`/`meAllTime` answer "have you yet?".
   */
  const eligibleRow = await env.DB.prepare(
    `SELECT (role = 'STUDENT' AND status = 'ACTIVE') AS eligible FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ eligible: number }>();
  const meEligible = Boolean(eligibleRow?.eligible);
  // A week runs Monday to Sunday: the bounds are the first instant of Monday
  // and the last millisecond of Sunday.
  const weekEnd = weekStart ? new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000) : null;
  const dayFrom = weekStart ?? DAY_MIN;
  const dayTo = weekEnd ? new Date(weekEnd.getTime() - 86_400_000).toISOString().slice(0, 10) : DAY_MAX;
  const instantFrom = weekStart ? `${weekStart}T00:00:00.000Z` : INSTANT_MIN;
  const instantTo = weekEnd ? new Date(weekEnd.getTime() - 1).toISOString() : INSTANT_MAX;

  if (scope === 'learn') {
    const sql = `SELECT p.user_id AS user_id,
                        COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
                        COALESCE(NULLIF(CASE WHEN up.avatar_kind = 'PRESET' THEN up.avatar_preset END, ''), '') AS avatar,
                        ${window === 'all' ? 'p.xp' : 'COALESCE(SUM(l.xp), 0)'} AS value,
                        p.streak AS streak
                   FROM learn_profiles p
                   JOIN users u ON u.id = p.user_id
              LEFT JOIN user_profiles up ON up.user_id = p.user_id
              LEFT JOIN learn_xp_log l ON l.user_id = p.user_id AND l.day >= ? AND l.day <= ?
                  WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE'
               GROUP BY p.user_id
                 HAVING value > 0
               ORDER BY value DESC, streak DESC, p.user_id
                  LIMIT ?`;
    const rows = await env.DB.prepare(sql)
      .bind(dayFrom, dayTo, LEADERBOARD_LIMIT)
      .all<LearnRow>();

    // The reader's own row. No role filter: the list is a class board, this is a
    // mirror, and a mirror that hides you because of your role looks broken.
    const meRow = await env.DB.prepare(
      `SELECT p.user_id AS user_id,
              COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
              COALESCE(NULLIF(CASE WHEN up.avatar_kind = 'PRESET' THEN up.avatar_preset END, ''), '') AS avatar,
              ${window === 'all' ? 'p.xp' : 'COALESCE(SUM(l.xp), 0)'} AS value,
              p.streak AS streak
         FROM learn_profiles p
    LEFT JOIN user_profiles up ON up.user_id = p.user_id
    LEFT JOIN learn_xp_log l ON l.user_id = p.user_id AND l.day >= ? AND l.day <= ?
        WHERE p.user_id = ?
     GROUP BY p.user_id`,
    )
      .bind(dayFrom, dayTo, userId)
      .first<LearnRow>();

    // The same reader over all time, so a week board with nothing on it yet can
    // say so with the number they actually have rather than a blank.
    const meAllTimeRow =
      window === 'all'
        ? meRow
        : await env.DB
            .prepare(
              `SELECT p.user_id AS user_id,
                      COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
                      COALESCE(NULLIF(CASE WHEN up.avatar_kind = 'PRESET' THEN up.avatar_preset END, ''), '') AS avatar,
                      p.xp AS value,
                      p.streak AS streak
                 FROM learn_profiles p
           LEFT JOIN user_profiles up ON up.user_id = p.user_id
                WHERE p.user_id = ?`,
            )
            .bind(userId)
            .first<LearnRow>();

    // Rank = how many candidates on the board are strictly ahead, plus one.
    // Ties share a rank, which is the only honest reading when two people have
    // the same XP. A reader who is not on the competing list still gets a rank
    // against it, so "you would be 3rd" is a real statement.
    const ahead = meRow
      ? await env.DB.prepare(
          window === 'all'
            ? `SELECT COUNT(*) AS ahead
                 FROM learn_profiles p JOIN users u ON u.id = p.user_id
                WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND p.xp > ?`
            : `SELECT COUNT(*) AS ahead FROM (
                 SELECT l.user_id AS user_id, SUM(l.xp) AS value
                   FROM learn_xp_log l JOIN users u ON u.id = l.user_id
                  WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND l.day >= ? AND l.day <= ?
                  GROUP BY l.user_id HAVING value > ?
               )`,
        )
          .bind(...(window === 'all' ? [meRow.value] : [dayFrom, dayTo, meRow.value]))
          .first<{ ahead: number }>()
      : null;

    // The all-time mirror needs its own rank: counting the week's leaders ahead
    // of an all-time total would put everybody at #1.
    const aheadAllTime =
      window === 'week' && meAllTimeRow && meAllTimeRow.value > 0
        ? await env.DB.prepare(
            `SELECT COUNT(*) AS ahead
               FROM learn_profiles p JOIN users u ON u.id = p.user_id
              WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND p.xp > ?`,
          )
            .bind(meAllTimeRow.value)
            .first<{ ahead: number }>()
        : null;

    const total = await env.DB.prepare(
      window === 'all'
        ? `SELECT COUNT(*) AS total FROM learn_profiles p JOIN users u ON u.id = p.user_id
            WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND p.xp > 0`
        : `SELECT COUNT(*) AS total FROM (
             SELECT l.user_id AS user_id, SUM(l.xp) AS value
               FROM learn_xp_log l JOIN users u ON u.id = l.user_id
              WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND l.day >= ? AND l.day <= ?
              GROUP BY l.user_id HAVING value > 0
           )`,
    )
      .bind(...(window === 'all' ? [] : [dayFrom, dayTo]))
      .first<{ total: number }>();

    return {
      scope,
      window,
      rows: (rows.results ?? []).map((row, index) => learnRow(row, index + 1, userId)),
      // A reader with no XP in the window has no rank to show; one with XP
      // always has one, even when it is below the fifty rows returned.
      me: meRow && meRow.value > 0 ? learnRow(meRow, (ahead?.ahead ?? 0) + 1, userId) : null,
      meAllTime:
        meAllTimeRow && meAllTimeRow.value > 0
          ? learnRow(meAllTimeRow, window === 'all' ? (ahead?.ahead ?? 0) + 1 : (aheadAllTime?.ahead ?? 0) + 1, userId)
          : null,
      meEligible,
      total: total?.total ?? 0,
      weekStart,
      valueLabel: 'XP earned',
    };
  }

  // Practice: submitted attempts, with the best band as the second fact.
  const rows = await env.DB.prepare(
    `SELECT a.user_id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
            COALESCE(NULLIF(CASE WHEN MAX(up.avatar_kind) = 'PRESET' THEN MAX(up.avatar_preset) END, ''), '') AS avatar,
            COUNT(*) AS value,
            MAX(a.estimated_band) AS best_band
       FROM attempts a
       JOIN users u ON u.id = a.user_id
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
      WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
        AND a.submitted_at >= ? AND a.submitted_at <= ?
   GROUP BY a.user_id
   ORDER BY value DESC, best_band DESC, a.user_id
      LIMIT ?`,
  )
    .bind(instantFrom, instantTo, LEADERBOARD_LIMIT)
    .all<PracticeRow>();

  // As above: the reader's own row ignores the role filter that shapes the list.
  const meRow = await env.DB.prepare(
    `SELECT a.user_id AS user_id,
            COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
            COALESCE(NULLIF(CASE WHEN MAX(up.avatar_kind) = 'PRESET' THEN MAX(up.avatar_preset) END, ''), '') AS avatar,
            COUNT(*) AS value,
            MAX(a.estimated_band) AS best_band
       FROM attempts a
  LEFT JOIN user_profiles up ON up.user_id = a.user_id
      WHERE a.user_id = ? AND a.status = 'SUBMITTED'
        AND a.submitted_at >= ? AND a.submitted_at <= ?
   GROUP BY a.user_id`,
  )
    .bind(userId, instantFrom, instantTo)
    .first<PracticeRow>();

  const meAllTimeRow =
    window === 'all'
      ? meRow
      : await env.DB
          .prepare(
            `SELECT a.user_id AS user_id,
                    COALESCE(NULLIF(up.display_name, ''), 'Learner') AS name,
                    COALESCE(NULLIF(CASE WHEN MAX(up.avatar_kind) = 'PRESET' THEN MAX(up.avatar_preset) END, ''), '') AS avatar,
                    COUNT(*) AS value,
                    MAX(a.estimated_band) AS best_band
               FROM attempts a
          LEFT JOIN user_profiles up ON up.user_id = a.user_id
              WHERE a.user_id = ? AND a.status = 'SUBMITTED'
           GROUP BY a.user_id`,
          )
          .bind(userId)
          .first<PracticeRow>();

  const ahead = meRow
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS ahead FROM (
           SELECT a.user_id AS user_id, COUNT(*) AS value
             FROM attempts a JOIN users u ON u.id = a.user_id
            WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
              AND a.submitted_at >= ? AND a.submitted_at <= ?
            GROUP BY a.user_id HAVING value > ?
         )`,
      )
        .bind(instantFrom, instantTo, meRow.value)
        .first<{ ahead: number }>()
    : null;

  const aheadAllTime =
    window === 'week' && meAllTimeRow
      ? await env.DB
          .prepare(
            `SELECT COUNT(*) AS ahead FROM (
               SELECT a.user_id AS user_id, COUNT(*) AS value
                 FROM attempts a JOIN users u ON u.id = a.user_id
                WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
                GROUP BY a.user_id HAVING value > ?
             )`,
          )
          .bind(meAllTimeRow.value)
          .first<{ ahead: number }>()
      : null;

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM (
       SELECT a.user_id AS user_id, COUNT(*) AS value
         FROM attempts a JOIN users u ON u.id = a.user_id
        WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND a.status = 'SUBMITTED'
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
    meAllTime: meAllTimeRow
      ? practiceRow(meAllTimeRow, window === 'all' ? (ahead?.ahead ?? 0) + 1 : (aheadAllTime?.ahead ?? 0) + 1, userId)
      : null,
    meEligible,
    total: total?.total ?? 0,
    weekStart,
    valueLabel: window === 'week' ? 'Tests this week' : 'Tests taken',
  };
}
