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
  deleteClass,
  getClass,
  getMentorProfile,
  getMentorReviews,
  joinClass,
  joinRoom,
  confirmSession,
  declineSession,
  kickParticipant,
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
import { notify } from '../services/notification-service';
import {
  answerPoll,
  closeBreakouts,
  closePoll,
  createBreakouts,
  createPoll,
  getWhiteboard,
  listBreakouts,
  listPolls,
  saveWhiteboard,
} from '../services/live-class-service';
import { mentorEarnings, mentorInvoice } from '../services/digest-service';

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
  await notify(c.env, {
    userId: session.mentorId,
    kind: 'BOOKING',
    title: 'New booking request',
    body: `${user.displayName} asked for a session: ${session.topic || 'IELTS coaching'}.`,
    href: '/mentor/console',
    email: true,
  });
  return c.json({ session }, 201);
});

/** The mentor accepts a booking request (status REQUESTED → SCHEDULED). */
router.post('/mentor/sessions/:sessionId/confirm', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const session = await confirmSession(c.env, user, c.req.param('sessionId'));
  await notify(c.env, {
    userId: session.studentId,
    kind: 'BOOKING',
    title: 'Your session is confirmed',
    body: `${session.topic || 'Your mentor session'} starts ${new Date(session.startsAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`,
    href: '/my-sessions',
    email: true,
  });
  return c.json({ session });
});

/** Decline / cancel a booking; coins paid are refunded to the learner. */
router.post('/mentor/sessions/:sessionId/decline', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ reason: z.string().max(500).optional() }).optional().default({}));
  const session = await declineSession(c.env, user, c.req.param('sessionId'), body.reason);
  const counterpartId = user.id === session.mentorId ? session.studentId : session.mentorId;
  await notify(c.env, {
    userId: counterpartId,
    kind: 'BOOKING',
    title: 'A session was cancelled',
    body: body.reason?.trim() ? `Reason: ${body.reason.trim()}` : 'The booking was cancelled and any coins were refunded.',
    href: '/my-sessions',
    email: true,
  });
  return c.json({ session });
});

/** Room moderation: kick (or ban) a participant. Only the mentor or an admin. */
router.post('/mentor/sessions/:sessionId/kick', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ userId: z.string().min(1).max(64), ban: z.boolean().optional() }));
  const result = await kickParticipant(c.env, user, c.req.param('sessionId'), body.userId, body.ban ?? false);
  // Tell everyone — especially the target — right away.
  await postSignal(c.env, user, c.req.param('sessionId'), {
    kind: 'KICK',
    targetId: body.userId,
    payload: body.ban ? 'banned' : 'kicked',
  });
  return c.json(result);
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

function mediaFromQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const cam = c.req.query('cam');
  const mic = c.req.query('mic');
  // Older clients send no flags: assume both devices are on.
  return { cam: cam === undefined ? true : cam !== '0', mic: mic === undefined ? true : mic !== '0' };
}

router.get('/mentor/sessions/:sessionId/room', async (c) => {
  const user = currentUser(c);
  const since = c.req.query('since') || null;
  const room = c.req.query('room') || 'main';
  const state = await roomState(c.env, user, c.req.param('sessionId'), since, room, mediaFromQuery(c));
  return c.json(state);
});

router.post('/mentor/sessions/:sessionId/join', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await joinRoom(c.env, user, c.req.param('sessionId'), c.req.query('room') || 'main', mediaFromQuery(c));
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
    z.object({
      body: z.string().min(1).max(4000),
      kind: z.enum(['CHAT', 'NOTE']).optional(),
      room: z.string().max(40).optional(),
    }),
  );
  const message = await postMessage(
    c.env,
    user,
    c.req.param('sessionId'),
    body.body,
    body.kind ?? 'CHAT',
    body.room ?? 'main',
  );
  return c.json({ message }, 201);
});

router.post('/mentor/sessions/:sessionId/signal', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      kind: z.enum(['OFFER', 'ANSWER', 'CANDIDATE', 'BYE', 'HAND', 'MUTE_MIC', 'UNMUTE_MIC', 'KICK', 'REACTION', 'WHITEBOARD']),
      targetId: z.string().min(1).max(64).nullable().optional(),
      payload: z.string().max(120_000),
      room: z.string().max(40).optional(),
    }),
  );
  const result = await postSignal(c.env, user, c.req.param('sessionId'), {
    kind: body.kind,
    targetId: body.targetId ?? null,
    payload: body.payload,
    roomKey: body.room ?? 'main',
  });
  return c.json(result, 201);
});

// ------------------------------------------------------------------------- live extras

router.get('/mentor/sessions/:sessionId/polls', async (c) => {
  const user = currentUser(c);
  const room = c.req.query('room') || 'main';
  return c.json({ polls: await listPolls(c.env, user, c.req.param('sessionId'), room) });
});

router.post('/mentor/sessions/:sessionId/polls', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      question: z.string().min(3).max(500),
      options: z.array(z.string().min(1).max(160)).min(2).max(6),
      kind: z.enum(['QUIZ', 'POLL']).optional(),
      correctIndex: z.number().int().min(0).max(5).nullable().optional(),
      room: z.string().max(40).optional(),
    }),
  );
  const poll = await createPoll(c.env, user, c.req.param('sessionId'), body.room ?? 'main', body);
  return c.json({ poll }, 201);
});

router.post('/mentor/sessions/:sessionId/polls/:pollId/answer', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ choiceIndex: z.number().int().min(0).max(5) }));
  const poll = await answerPoll(c.env, user, c.req.param('sessionId'), c.req.param('pollId'), body.choiceIndex);
  return c.json({ poll });
});

router.post('/mentor/sessions/:sessionId/polls/:pollId/close', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const poll = await closePoll(c.env, user, c.req.param('sessionId'), c.req.param('pollId'));
  return c.json({ poll });
});

router.get('/mentor/sessions/:sessionId/breakouts', async (c) => {
  const user = currentUser(c);
  return c.json(await listBreakouts(c.env, user, c.req.param('sessionId')));
});

router.post('/mentor/sessions/:sessionId/breakouts', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ count: z.number().int().min(2).max(4), minutes: z.number().int().min(5).max(60) }));
  return c.json(await createBreakouts(c.env, user, c.req.param('sessionId'), body));
});

router.post('/mentor/sessions/:sessionId/breakouts/close', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await closeBreakouts(c.env, user, c.req.param('sessionId')));
});

router.get('/mentor/sessions/:sessionId/whiteboard', async (c) => {
  const user = currentUser(c);
  const room = c.req.query('room') || 'main';
  return c.json(await getWhiteboard(c.env, user, c.req.param('sessionId'), room));
});

router.put('/mentor/sessions/:sessionId/whiteboard', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      room: z.string().max(40).optional(),
      revision: z.number().int().min(0),
      strokes: z.array(z.unknown()).max(600),
    }),
  );
  return c.json(
    await saveWhiteboard(c.env, user, c.req.param('sessionId'), body.room ?? 'main', body.revision, body.strokes),
  );
});

// ------------------------------------------------------------------------------ earnings

router.get('/mentor/me/earnings', async (c) => {
  const user = currentUser(c);
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;
  return c.json(await mentorEarnings(c.env, user, { from, to }));
});

router.get('/mentor/me/earnings/:sessionId/invoice', async (c) => {
  const user = currentUser(c);
  return c.json(await mentorInvoice(c.env, user, c.req.param('sessionId')));
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

/** The mentor who leads the class — or any administrator — deletes it outright. */
router.delete('/mentor/classes/:classId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await deleteClass(c.env, user, c.req.param('classId')));
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
