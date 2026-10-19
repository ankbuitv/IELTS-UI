/**
 * In-app notification centre.
 *
 * `notify()` is deliberately fire-and-forget: a notification is a side effect
 * of a booking, a marking run or a broadcast, and must never turn a successful
 * action into a 500. Every call is wrapped and only logs on failure.
 *
 * Recipients see notifications in the header bell (newest first, unread badge)
 * and on `/notifications`. Clicking one marks it read and follows `href`.
 */
import type { Env } from '../env';
import { newId, nowIso } from '../lib/ids';
import { notificationEmail, sendEmail } from './email-service';
import type { Role } from '../../shared/types';

export type NotificationKind =
  | 'SYSTEM'
  | 'MARKING'
  | 'BOOKING'
  | 'CLASS'
  | 'ASSIGNMENT'
  | 'ACHIEVEMENT'
  | 'BILLING';

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** In-app path opened when the notification is clicked. */
  href?: string;
  /** Also email it (respects the provider being configured; always logged). */
  email?: boolean;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: NotificationRow[];
  unread: number;
}

/** Creates one notification. Never throws. */
export async function notify(env: Env, input: NotifyInput): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, href, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
      .bind(newId('ntf', 16), input.userId, input.kind, input.title, input.body ?? '', input.href ?? null, nowIso())
      .run();
  } catch (error) {
    console.error('notify_failed', input.userId, input.kind, (error as Error).message);
    return;
  }

  if (!input.email) return;
  try {
    const recipient = await env.DB.prepare('SELECT email, status FROM users WHERE id = ?')
      .bind(input.userId)
      .first<{ email: string; status: string }>();
    if (!recipient || recipient.status !== 'ACTIVE') return;
    const message = notificationEmail(env, input.title, input.body ?? '', input.href);
    await sendEmail(env, { ...message, to: recipient.email });
  } catch (error) {
    console.error('notify_email_failed', input.userId, (error as Error).message);
  }
}

/** Fans one notification out to many users (class announcement, broadcast). */
export async function notifyMany(env: Env, userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) await notify(env, { ...input, userId });
  return unique.length;
}

/** Notifies every user with one of the given roles. */
export async function notifyRole(env: Env, role: Role, input: Omit<NotifyInput, 'userId'>): Promise<number> {
  const rows = await env.DB.prepare('SELECT id FROM users WHERE role = ? AND status = ?')
    .bind(role, 'ACTIVE')
    .all<{ id: string }>();
  return notifyMany(env, (rows.results ?? []).map((row) => row.id), input);
}

const LIST_LIMIT = 40;

export async function listNotifications(env: Env, userId: string): Promise<NotificationList> {
  const [rows, unread] = await Promise.all([
    env.DB.prepare(
      `SELECT id, kind, title, body, href, read_at, created_at
         FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
      .bind(userId, LIST_LIMIT)
      .all<{ id: string; kind: NotificationKind; title: string; body: string; href: string | null; read_at: string | null; created_at: string }>(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL')
      .bind(userId)
      .first<{ total: number }>(),
  ]);

  return {
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unread: unread?.total ?? 0,
  };
}

export async function markNotificationRead(env: Env, userId: string, id: string): Promise<void> {
  await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
    .bind(nowIso(), id, userId)
    .run();
}

export async function markAllNotificationsRead(env: Env, userId: string): Promise<number> {
  const result = await env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .bind(nowIso(), userId)
    .run();
  return result.meta.changes ?? 0;
}
