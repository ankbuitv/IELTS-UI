/**
 * Notification centre API — the header bell and the `/notifications` page.
 *
 * Everything here is scoped to the signed-in user; there is no way to read or
 * acknowledge another account's notifications.
 */
import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification-service';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

/** Newest 40 + unread count — one request powers the bell and the page. */
router.get('/', async (c) => {
  const user = currentUser(c);
  return c.json(await listNotifications(c.env, user.id));
});

router.post('/:notificationId/read', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const { notificationId } = c.req.param();
  await markNotificationRead(c.env, user.id, notificationId);
  return c.json({ ok: true });
});

router.post('/read-all', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const updated = await markAllNotificationsRead(c.env, user.id);
  return c.json({ ok: true, updated });
});

export default router;
