import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import { acceptClassroomInvite, joinClassroomByCode } from '../services/teacher-service';

const router = new Hono<AppBindings>();

router.use('/classrooms/*', requireAuth);
router.use('/classrooms/*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

/** Students join a classroom with an invitation link token or the join code. */
router.post('/classrooms/join', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      token: z.string().min(10).max(200).optional(),
      code: z.string().min(4).max(16).optional(),
    }),
  );

  if (!body.token && !body.code) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Provide an invitation token or a join code.' } }, 400);
  }

  const result = body.token
    ? await acceptClassroomInvite(c.env, user, body.token)
    : await joinClassroomByCode(c.env, user, body.code!);

  return c.json({ ok: true, ...result });
});

router.get('/classrooms/mine', requireAuth, async (c) => {
  const user = currentUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.status, m.role, m.joined_at,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id AND a.status = 'ACTIVE') AS active_assignments
       FROM classroom_members m
       JOIN classrooms c ON c.id = m.classroom_id
      WHERE m.user_id = ? AND m.status = 'ACTIVE'
      ORDER BY c.name`,
  )
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      description: string;
      status: string;
      role: string;
      joined_at: string;
      active_assignments: number;
    }>();

  return c.json({
    classrooms: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      role: row.role,
      joinedAt: row.joined_at,
      activeAssignments: row.active_assignments,
    })),
  });
});

export default router;
