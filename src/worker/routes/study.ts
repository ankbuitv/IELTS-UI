/**
 * Study groups and study rooms.
 *
 * Group membership is open to any signed-in learner; rooms are joined by id
 * from the list. The pomodoro clock is server-owned, and heartbeat calls are
 * what keep a participant visible and accrue focus minutes.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody, parseQuery } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  createStudyGroup,
  createStudyRoom,
  getStudyGroup,
  getStudyRoom,
  getStudyGroups,
  heartbeatStudyRoom,
  joinStudyGroup,
  joinStudyRoom,
  leaveStudyGroup,
  leaveStudyRoom,
  listStudyRooms,
  setRoomPhase,
} from '../services/study-service';

export const studyRouter = new Hono<AppBindings>();
studyRouter.use('*', requireAuth);

const dayQuery = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

function dayFrom(value: string | undefined): string {
  return value ?? new Date().toISOString().slice(0, 10);
}

studyRouter.get('/groups', async (c) => {
  const user = currentUser(c);
  const query = parseQuery(c, dayQuery);
  return c.json(await getStudyGroups(c.env, user.id, dayFrom(query.day)));
});

studyRouter.post('/groups', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ name: z.string().min(3).max(40), goal: z.string().max(120).default(''), targetBand: z.number().min(4).max(9) }),
  );
  return c.json(await createStudyGroup(c.env, user.id, body, new Date().toISOString().slice(0, 10)), 201);
});

studyRouter.get('/groups/:groupId', async (c) => {
  const user = currentUser(c);
  return c.json(await getStudyGroup(c.env, user.id, c.req.param('groupId')));
});

studyRouter.post('/groups/:groupId/join', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await joinStudyGroup(c.env, user.id, c.req.param('groupId')));
});

studyRouter.delete('/groups/:groupId/leave', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await leaveStudyGroup(c.env, user.id, c.req.param('groupId'));
  return c.json({ ok: true });
});

studyRouter.get('/rooms', async (c) => {
  const user = currentUser(c);
  const query = parseQuery(c, dayQuery);
  return c.json(await listStudyRooms(c.env, user.id, dayFrom(query.day)));
});

studyRouter.post('/rooms', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      name: z.string().min(3).max(50),
      topic: z.string().max(120).default(''),
      focusMinutes: z.number().int().min(5).max(60).optional(),
      breakMinutes: z.number().int().min(1).max(20).optional(),
    }),
  );
  return c.json(await createStudyRoom(c.env, user.id, body), 201);
});

studyRouter.get('/rooms/:roomId', async (c) => {
  const user = currentUser(c);
  const query = parseQuery(c, dayQuery);
  return c.json(await getStudyRoom(c.env, user.id, c.req.param('roomId'), dayFrom(query.day)));
});

studyRouter.post('/rooms/:roomId/join', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({}));
  return c.json(await joinStudyRoom(c.env, user.id, c.req.param('roomId'), dayFrom(body.day)));
});

studyRouter.post('/rooms/:roomId/heartbeat', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({}));
  return c.json(await heartbeatStudyRoom(c.env, user.id, c.req.param('roomId'), dayFrom(body.day)));
});

studyRouter.post('/rooms/:roomId/phase', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ action: z.enum(['start', 'skip', 'stop']) }));
  const query = parseQuery(c, dayQuery);
  return c.json(await setRoomPhase(c.env, user.id, c.req.param('roomId'), body.action, dayFrom(query.day)));
});

studyRouter.delete('/rooms/:roomId/leave', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await leaveStudyRoom(c.env, user.id, c.req.param('roomId'));
  return c.json({ ok: true });
});
