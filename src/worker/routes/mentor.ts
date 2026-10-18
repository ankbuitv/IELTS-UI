/**
 * Mentor API — booking, live call rooms, classes and the mentor console.
 *
 * Everything is session-scoped: a room is only visible to its mentor, its
 * student (or an administrator). WebRTC signalling is relayed through D1 so two
 * browsers in the same room can connect peer-to-peer without a realtime service.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  bookSession,
  classMessages,
  classRoomSessionId,
  cancelSession,
  completeSession,
  createClass,
  getClass,
  getMentorProfile,
  getMentorReviews,
  joinClass,
  joinRoom,
  leaveClass,
  leaveRoom,
  listClasses,
  listMentors,
  listSessionsFor,
  mentorConsole,
  postClassMessage,
  postMessage,
  postSignal,
  reviewSession,
  roomState,
  setAvailability,
  setHandRaised,
  upsertMentorProfile,
} from '../services/mentor-service';

const router = new Hono<AppBindings>();

router.use('/mentor/*', requireAuth);
router.use('/mentor/*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

// ------------------------------------------------------------------------------ directory

router.get('/mentor/directory', async (c) => {
  const specialty = c.req.query('specialty') ?? undefined;
  return c.json({ mentors: await listMentors(c.env, specialty) });
});

router.get('/mentor/:mentorId', async (c) => {
  const user = currentUser(c);
  const profile = await getMentorProfile(c.env, c.req.param('mentorId'), user);
  const reviews = await getMentorReviews(c.env, c.req.param('mentorId'));
  return c.json({ mentor: profile, reviews });
});

// ------------------------------------------------------------------------------ sessions

router.get('/mentor/me/sessions', async (c) => {
  const user = currentUser(c);
  const scope = c.req.query('scope');
  const sessions = await listSessionsFor(c.env, user, scope === 'upcoming' || scope === 'past' ? scope : 'all');
  return c.json({ sessions });
});

router.post('/mentor/:mentorId/book', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      startsAt: z.string().min(8),
      durationMinutes: z.number().int().min(15).max(180),
      topic: z.string().max(160),
    }),
  );
  const session = await bookSession(c.env, user, c.req.param('mentorId'), body);
  return c.json({ session }, 201);
});

router.post('/mentor/sessions/:sessionId/cancel', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ reason: z.string().max(500).optional() }).optional().default({}));
  const session = await cancelSession(c.env, user, c.req.param('sessionId'), body.reason);
  return c.json({ session });
});

router.post('/mentor/sessions/:sessionId/complete', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ feedback: z.string().max(2000).optional() }).optional().default({}));
  const session = await completeSession(c.env, user, c.req.param('sessionId'), body.feedback);
  return c.json({ session });
});

router.post('/mentor/sessions/:sessionId/review', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ rating: z.number().min(1).max(5), comment: z.string().max(2000).optional() }));
  await reviewSession(c.env, user, c.req.param('sessionId'), body.rating, body.comment ?? '');
  return c.json({ ok: true });
});

// ------------------------------------------------------------------------------ room

router.get('/mentor/sessions/:sessionId/room', async (c) => {
  const user = currentUser(c);
  const since = c.req.query('since') || null;
  const state = await roomState(c.env, user, c.req.param('sessionId'), since);
  return c.json(state);
});

router.post('/mentor/sessions/:sessionId/join', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await joinRoom(c.env, user, c.req.param('sessionId'));
  return c.json({ ok: true });
});

router.post('/mentor/sessions/:sessionId/leave', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await leaveRoom(c.env, user, c.req.param('sessionId'));
  return c.json({ ok: true });
});

router.post('/mentor/sessions/:sessionId/hand', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ raised: z.boolean() }));
  await setHandRaised(c.env, user, c.req.param('sessionId'), body.raised);
  return c.json({ ok: true });
});

router.post('/mentor/sessions/:sessionId/messages', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ body: z.string().min(1).max(4000), kind: z.enum(['CHAT', 'NOTE']).optional() }),
  );
  const message = await postMessage(c.env, user, c.req.param('sessionId'), body.body, body.kind ?? 'CHAT');
  return c.json({ message }, 201);
});

router.post('/mentor/sessions/:sessionId/signal', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      kind: z.enum(['OFFER', 'ANSWER', 'CANDIDATE', 'BYE']),
      targetId: z.string().min(1).max(64).nullable().optional(),
      payload: z.string().max(120_000),
    }),
  );
  const result = await postSignal(c.env, user, c.req.param('sessionId'), {
    kind: body.kind,
    targetId: body.targetId ?? null,
    payload: body.payload,
  });
  return c.json(result, 201);
});

// ------------------------------------------------------------------------------ classes

router.get('/mentor/classes/list', async (c) => {
  const user = currentUser(c);
  return c.json({ classes: await listClasses(c.env, user) });
});

router.post('/mentor/classes', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().min(3).max(140),
      description: z.string().max(2000).optional().default(''),
      level: z.string().max(60).optional().default('All levels'),
      capacity: z.number().int().min(2).max(5000).optional().default(10),
      priceCoins: z.number().int().min(0).max(10_000).optional().default(0),
      startsAt: z.string().min(8),
      endsAt: z.string().min(8),
      recurrence: z.string().max(120).nullable().optional(),
    }),
  );
  const mentorClass = await createClass(c.env, user, {
    ...body,
    recurrence: body.recurrence ?? null,
    description: body.description ?? '',
  });
  return c.json({ class: mentorClass }, 201);
});

router.post('/mentor/classes/:classId/join', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json({ class: await joinClass(c.env, user, c.req.param('classId')) });
});

router.post('/mentor/classes/:classId/leave', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json({ class: await leaveClass(c.env, user, c.req.param('classId')) });
});

// ------------------------------------------------------------------------------ class chat & room

router.get('/mentor/classes/:classId', async (c) => {
  const user = currentUser(c);
  return c.json({ class: await getClass(c.env, user, c.req.param('classId')) });
});

router.get('/mentor/classes/:classId/messages', async (c) => {
  const user = currentUser(c);
  return c.json({ messages: await classMessages(c.env, user, c.req.param('classId')) });
});

router.post('/mentor/classes/:classId/messages', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ body: z.string().min(1).max(4000) }));
  const message = await postClassMessage(c.env, user, c.req.param('classId'), body.body);
  return c.json({ message }, 201);
});

/** The class's shared call room (created on demand). */
router.get('/mentor/classes/:classId/room', async (c) => {
  const user = currentUser(c);
  return c.json(await classRoomSessionId(c.env, user, c.req.param('classId')));
});

// ------------------------------------------------------------------------------ console

router.get('/mentor/console/overview', async (c) => {
  const user = currentUser(c);
  return c.json(await mentorConsole(c.env, user));
});

router.post('/mentor/profile', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      headline: z.string().max(140).optional().default(''),
      bio: z.string().max(4000).optional().default(''),
      specialties: z.array(z.string().max(40)).max(12).optional().default([]),
      languages: z.array(z.string().max(40)).max(8).optional().default([]),
      hourlyRateCoins: z.number().int().min(0).max(10_000).optional().default(0),
      yearsExperience: z.number().int().min(0).max(60).optional().default(0),
    }),
  );
  await upsertMentorProfile(c.env, user, body);
  return c.json({ ok: true });
});

router.put('/mentor/availability', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      slots: z
        .array(
          z.object({
            weekday: z.number().int().min(0).max(6),
            startMinute: z.number().int().min(0).max(1430),
            endMinute: z.number().int().min(10).max(1440),
          }),
        )
        .max(40),
    }),
  );
  await setAvailability(c.env, user, body.slots);
  return c.json({ ok: true });
});

export default router;
