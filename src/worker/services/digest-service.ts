import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { appUrl, digestEmail, sendEmail } from './email-service';
import { notify } from './notification-service';
import type { WeeklyDigest } from '../../shared/live';

/**
 * Weekly recap: one email + one notification per active learner, every Monday.
 *
 * The run is idempotent per user per ISO week (`user_digests`), so a cron retry,
 * a manual admin run and a local smoke test can all call it without spamming
 * anyone. Weeks start on Monday 00:00 UTC.
 */

export function weekStartFor(date: Date): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? 6 : day - 1;
  copy.setUTCDate(copy.getUTCDate() - offset);
  return copy;
}

export function weekKeyFor(date: Date): string {
  return weekStartFor(date).toISOString().slice(0, 10);
}

function roundBand(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

interface ActivityRow {
  user_id: string;
  display_name: string;
}

/** Users with something worth recapping in the week that starts at `from`. */
async function activeUsers(env: Env, fromIso: string, toIso: string, limit: number): Promise<ActivityRow[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT u.id AS user_id,
            COALESCE(NULLIF(p.display_name, ''), u.username, 'there') AS display_name
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.status = 'ACTIVE'
        AND (
          EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = u.id AND a.submitted_at >= ? AND a.submitted_at < ?)
          OR EXISTS (SELECT 1 FROM learn_profiles lp WHERE lp.user_id = u.id AND lp.last_active_day >= ? AND lp.last_active_day < ?)
          OR EXISTS (SELECT 1 FROM mentor_sessions s WHERE s.student_id = u.id AND s.starts_at >= ? AND s.starts_at < ? AND s.student_id <> s.mentor_id)
        )
      ORDER BY u.created_at
      LIMIT ?`,
  )
    .bind(fromIso, toIso, fromIso.slice(0, 10), toIso.slice(0, 10), fromIso, toIso, limit)
    .all<ActivityRow>();
  return rows.results;
}

async function digestFor(env: Env, userId: string, name: string, fromIso: string, toIso: string): Promise<WeeklyDigest> {
  const skills = await env.DB.prepare(
    `SELECT sess.skill, COUNT(*) AS n, AVG(sess.estimated_band) AS avg_band, MAX(sess.estimated_band) AS best_band
       FROM attempt_skill_sessions sess
       JOIN attempts a ON a.id = sess.attempt_id
      WHERE a.user_id = ? AND sess.submitted_at >= ? AND sess.submitted_at < ?
      GROUP BY sess.skill
      ORDER BY sess.skill`,
  )
    .bind(userId, fromIso, toIso)
    .all<{ skill: string; n: number; avg_band: number | null; best_band: number | null }>();

  const previous = await env.DB.prepare(
    `SELECT AVG(sess.estimated_band) AS band
       FROM attempt_skill_sessions sess
       JOIN attempts a ON a.id = sess.attempt_id
      WHERE a.user_id = ? AND sess.submitted_at >= ? AND sess.submitted_at < ?`,
  )
    .bind(userId, new Date(Date.parse(fromIso) - 7 * 86_400_000).toISOString(), fromIso)
    .first<{ band: number | null }>();

  const bandRows = skills.results.filter((row) => row.avg_band !== null);
  const band = bandRows.length
    ? roundBand(bandRows.reduce((sum, row) => sum + (row.avg_band ?? 0) * row.n, 0) / bandRows.reduce((sum, row) => sum + row.n, 0))
    : null;

  const upcoming = await env.DB.prepare(
    `SELECT s.id, COALESCE(NULLIF(s.topic, ''), c.title, 'Live session') AS title, s.starts_at
       FROM mentor_sessions s
       LEFT JOIN mentor_classes c ON c.id = s.class_id
      WHERE (s.student_id = ? OR (s.mentor_id = ? AND s.student_id = s.mentor_id))
        AND s.status IN ('SCHEDULED', 'ACTIVE')
        AND s.starts_at >= ?
      ORDER BY s.starts_at
      LIMIT 3`,
  )
    .bind(userId, userId, nowIso())
    .all<{ id: string; title: string; starts_at: string }>();

  const attended = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM mentor_sessions
      WHERE student_id = ? AND student_id <> mentor_id AND status = 'COMPLETED' AND ends_at >= ? AND ends_at < ?`,
  )
    .bind(userId, fromIso, toIso)
    .first<{ n: number }>();

  const learn = await env.DB.prepare('SELECT streak FROM learn_profiles WHERE user_id = ?')
    .bind(userId)
    .first<{ streak: number }>();

  const coins = await env.DB.prepare(
    'SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS n FROM learn_coin_log WHERE user_id = ? AND day >= ? AND day < ?',
  )
    .bind(userId, fromIso.slice(0, 10), toIso.slice(0, 10))
    .first<{ n: number }>();

  return {
    weekKey: fromIso.slice(0, 10),
    name,
    attempts: skills.results.reduce((sum, row) => sum + row.n, 0),
    band,
    previousBand: roundBand(previous?.band ?? null),
    skills: skills.results.map((row) => ({
      skill: row.skill,
      count: row.n,
      averageBand: roundBand(row.avg_band),
      bestBand: roundBand(row.best_band),
    })),
    sessionsAttended: attended?.n ?? 0,
    upcomingSessions: upcoming.results.map((row) => ({
      id: row.id,
      title: row.title,
      startsAt: row.starts_at,
    })),
    streakDays: learn?.streak ?? 0,
    coinsEarned: coins?.n ?? 0,
  };
}

export interface DigestRunOptions {
  /** Monday of the week to recap; defaults to the current one. */
  weekOf?: Date;
  limit?: number;
  dryRun?: boolean;
  /** Only recap this user (used by the "send me a test digest" button). */
  userId?: string;
}

export async function runWeeklyDigests(
  env: Env,
  options: DigestRunOptions = {},
): Promise<{ weekKey: string; sent: number; skipped: number; emails: Array<{ userId: string; email: string }> }> {
  const start = weekStartFor(options.weekOf ?? new Date());
  const fromIso = start.toISOString();
  const toIso = new Date(start.getTime() + 7 * 86_400_000).toISOString();
  const weekKey = fromIso.slice(0, 10);
  const limit = Math.max(1, Math.min(1000, options.limit ?? 500));

  let recipients: ActivityRow[] = [];
  if (options.userId) {
    const row = await env.DB.prepare(
      `SELECT u.id AS user_id, COALESCE(NULLIF(p.display_name, ''), u.username, 'there') AS display_name
         FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = ?`,
    )
      .bind(options.userId)
      .first<ActivityRow>();
    if (row) recipients = [row];
  } else {
    recipients = await activeUsers(env, fromIso, toIso, limit);
  }

  let sent = 0;
  let skipped = 0;
  const emails: Array<{ userId: string; email: string }> = [];
  for (const recipient of recipients) {
    const already = await env.DB.prepare('SELECT 1 AS ok FROM user_digests WHERE user_id = ? AND week_key = ?')
      .bind(recipient.user_id, weekKey)
      .first<{ ok: number }>();
    if (already) {
      skipped += 1;
      continue;
    }
    const digest = await digestFor(env, recipient.user_id, recipient.display_name, fromIso, toIso);
    if (!options.userId && digest.attempts === 0 && digest.sessionsAttended === 0) {
      skipped += 1;
      continue;
    }
    if (!options.dryRun) {
      await env.DB.prepare('INSERT OR IGNORE INTO user_digests (user_id, week_key, sent_at) VALUES (?, ?, ?)')
        .bind(recipient.user_id, weekKey, nowIso())
        .run();
      await notify(env, {
        userId: recipient.user_id,
        kind: 'SYSTEM',
        title: digest.band !== null ? `Your week: band ${digest.band.toFixed(1)}` : 'Your weekly recap',
        body:
          digest.attempts > 0
            ? `${digest.attempts} part${digest.attempts === 1 ? '' : 's'} practised, ${digest.streakDays}-day streak.`
            : 'A quiet week — your next session is waiting.',
        href: '/dashboard',
      });
      const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
        .bind(recipient.user_id)
        .first<{ email: string }>();
      if (user) {
        const message = digestEmail(env, digest, appUrl(env, '/dashboard'));
        await sendEmail(env, { ...message, to: user.email });
        emails.push({ userId: recipient.user_id, email: user.email });
      }
    }
    sent += 1;
  }
  return { weekKey, sent, skipped, emails };
}

// ------------------------------------------------------------------ earnings

export interface EarningsFilter {
  from?: string;
  to?: string;
}

function invoiceNumber(sessionId: string, startsAt: string): string {
  const compact = startsAt.slice(0, 7).replace('-', '');
  return `INV-${compact}-${sessionId.slice(-5).toUpperCase()}`;
}

export async function mentorEarnings(env: Env, viewer: AuthUser, filter: EarningsFilter = {}) {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') {
    throw ApiError.forbidden('Only mentors have earnings.');
  }
  // Include upcoming bookings so a mentor can see what is still to be earned.
  const to = filter.to ?? new Date(Date.now() + 90 * 86_400_000).toISOString();
  const from = filter.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT s.id, s.student_id, s.topic, s.starts_at, s.ends_at, s.paid_coins, s.status,
            COALESCE(NULLIF(p.display_name, ''), u.username, u.email, 'Student') AS student_name
       FROM mentor_sessions s
       JOIN users u ON u.id = s.student_id
       LEFT JOIN user_profiles p ON p.user_id = s.student_id
      WHERE s.mentor_id = ? AND s.student_id <> s.mentor_id
        AND s.status IN ('COMPLETED', 'SCHEDULED', 'ACTIVE')
        AND s.starts_at >= ? AND s.starts_at < ?
      ORDER BY s.starts_at DESC
      LIMIT 500`,
  )
    .bind(viewer.id, from, to)
    .all<{
      id: string;
      student_id: string;
      topic: string;
      starts_at: string;
      ends_at: string;
      paid_coins: number;
      status: string;
      student_name: string;
    }>();

  const mapped = rows.results.map((row) => ({
    sessionId: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    topic: row.topic,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minutes: Math.max(0, Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000)),
    coins: row.paid_coins,
    status: row.status,
    invoiceNumber: invoiceNumber(row.id, row.starts_at),
  }));

  const completed = mapped.filter((row) => row.status === 'COMPLETED');
  const pending = mapped.filter((row) => row.status !== 'COMPLETED');
  const monthMap = new Map<string, { coins: number; sessions: number }>();
  for (const row of completed) {
    const month = row.startsAt.slice(0, 7);
    const entry = monthMap.get(month) ?? { coins: 0, sessions: 0 };
    entry.coins += row.coins;
    entry.sessions += 1;
    monthMap.set(month, entry);
  }

  return {
    from,
    to,
    rows: mapped,
    totals: {
      completedSessions: completed.length,
      scheduledSessions: pending.length,
      completedHours: Math.round((completed.reduce((sum, row) => sum + row.minutes, 0) / 60) * 10) / 10,
      earnedCoins: completed.reduce((sum, row) => sum + row.coins, 0),
      pendingCoins: pending.reduce((sum, row) => sum + row.coins, 0),
    },
    byMonth: [...monthMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, entry]) => ({ month, ...entry })),
  };
}

export async function mentorInvoice(env: Env, viewer: AuthUser, sessionId: string) {
  if (viewer.role !== 'MENTOR' && viewer.role !== 'ADMIN') throw ApiError.forbidden('Only mentors have invoices.');
  const row = await env.DB.prepare(
    `SELECT s.id, s.student_id, s.topic, s.starts_at, s.ends_at, s.paid_coins, s.status,
            COALESCE(NULLIF(p.display_name, ''), u.username, u.email, 'Student') AS student_name,
            COALESCE(NULLIF(mp.display_name, ''), mu.username, mu.email, 'Mentor') AS mentor_name
       FROM mentor_sessions s
       JOIN users u ON u.id = s.student_id
       JOIN users mu ON mu.id = s.mentor_id
       LEFT JOIN user_profiles p ON p.user_id = s.student_id
       LEFT JOIN user_profiles mp ON mp.user_id = s.mentor_id
      WHERE s.id = ? AND s.mentor_id = ?`,
  )
    .bind(sessionId, viewer.id)
    .first<{
      id: string;
      student_id: string;
      topic: string;
      starts_at: string;
      ends_at: string;
      paid_coins: number;
      status: string;
      student_name: string;
      mentor_name: string;
    }>();
  if (!row) throw ApiError.notFound('Session not found.');
  const minutes = Math.max(0, Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60_000));
  return {
    number: invoiceNumber(row.id, row.starts_at),
    sessionId: row.id,
    mentorName: row.mentor_name,
    studentName: row.student_name,
    studentId: row.student_id,
    topic: row.topic,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minutes,
    coins: row.paid_coins,
    status: row.status,
    issuedAt: nowIso(),
  };
}
