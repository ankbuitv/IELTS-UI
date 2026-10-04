/**
 * Leaderboards: two boards, one for the learning path and one for practice.
 *
 * They answer different questions. The Learn board asks "who has been doing the
 * exercises", and is scored in XP, because XP is what the path pays for
 * finished work. The Practice board asks "who has been sitting tests", and is
 * scored in submitted attempts, with the best band shown beside it so a board
 * of pure volume cannot be mistaken for a board of skill.
 *
 * Both boards can be read for the current week or for all time, and both
 * include the reader's own row (with its rank) even when it falls outside the
 * list, because a board you cannot find yourself on is only a scoreboard.
 *
 * Nothing here identifies anybody beyond a display name: no email, no id.
 */

export const LEADERBOARD_SCOPES = ['learn', 'practice'] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

export const LEADERBOARD_WINDOWS = ['week', 'all'] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export function isLeaderboardScope(value: unknown): value is LeaderboardScope {
  return typeof value === 'string' && (LEADERBOARD_SCOPES as readonly string[]).includes(value);
}

export function isLeaderboardWindow(value: unknown): value is LeaderboardWindow {
  return typeof value === 'string' && (LEADERBOARD_WINDOWS as readonly string[]).includes(value);
}

export interface LeaderboardRow {
  rank: number;
  /** A display name, or "Learner" when the account has none. */
  name: string;
  /** The name is a shortened form for the row (initials are drawn client-side). */
  isMe: boolean;
  /** The number the board is ranked on (XP, or submitted attempts). */
  value: number;
  /** Ready-to-render value, so the two boards read the same everywhere. */
  valueLabel: string;
  /** A second fact about the row: the streak, or the best band. */
  secondary: string;
  /**
   * The coat name of a preset avatar, or '' when the row has none.
   *
   * Presets are shipped with the board because they are one short string the
   * client already knows how to draw. An uploaded picture is deliberately not:
   * a board has no business handing fifty people's profile pictures to every
   * reader, and the fallback (two initials in a coloured circle) is not a loss.
   */
  avatar: string;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  window: LeaderboardWindow;
  rows: LeaderboardRow[];
  /** The reader's own row, with its true rank, or null when they have no activity. */
  me: LeaderboardRow | null;
  /**
   * The reader's own row over all time, so a board set to "this week" can say
   * "nothing this week yet, 54 XP in total" instead of the flat "you are not on
   * this board" — which reads as a bug to somebody who finished a lesson ten
   * minutes ago and is looking at the wrong window.
   */
  meAllTime: LeaderboardRow | null;
  /**
   * Whether the reader's account competes on this board at all. The boards are
   * scoped to learner accounts; a teacher or an administrator who plays a lesson
   * still has a total, and is shown one, but is not ranked against the class.
   */
  meEligible: boolean;
  /** Everyone with activity in the window, not just the rows returned. */
  total: number;
  /** `YYYY-MM-DD` the week started on (Monday); null for all time. */
  weekStart: string | null;
  /** What the board is scored on, so a client need not hard-code it. */
  valueLabel: string;
}

/** How many rows a board sends. */
export const LEADERBOARD_LIMIT = 50;

export function formatXp(value: number): string {
  return `${value.toLocaleString('en')} XP`;
}

export function formatAttempts(value: number): string {
  return `${value.toLocaleString('en')} test${value === 1 ? '' : 's'}`;
}

/** Monday of the week `day` falls in, as `YYYY-MM-DD`. */
export function weekStartOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  // getUTCDay: 0 = Sunday, so Sunday belongs to the week that started six days earlier.
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}
