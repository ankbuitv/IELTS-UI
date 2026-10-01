import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { currentUser, requireAuth, requireRole } from '../middleware/auth';
import { base64ToBytes, parseRange } from '../services/blob-store';
import {
  createSpeakingSession,
  deleteSpeakingSession,
  listSpeakingQueue,
  listSpeakingSessions,
  loadSpeakingAudio,
  loadSpeakingSession,
  markSpeakingSessionAsStaff,
  saveSpeakingResponse,
  setSpeakingBand,
  speakingCatalog,
  submitSpeakingSession,
} from '../services/speaking-service';

const router = new Hono<AppBindings>();

router.use('*', requireAuth);
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

/** The topic catalog is the same for staff and candidates. */
router.get('/catalog', (c) => {
  return c.json({ topics: speakingCatalog() });
});

router.get('/sessions', async (c) => {
  const sessions = await listSpeakingSessions(c.env, currentUser(c));
  return c.json({ sessions });
});

/**
 * Staff review queue: every submitted session (the marking machine grades first,
 * so this is normally a spot-check list). Teachers see their own classrooms.
 */
router.get('/review-queue', requireRole('TEACHER', 'ADMIN'), async (c) => {
  const unmarkedOnly = c.req.query('unmarked') === '1';
  const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const queue = await listSpeakingQueue(c.env, currentUser(c), {
    unmarkedOnly,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return c.json(queue);
});

/** A human band always replaces the AI estimate and is labelled as such. */
router.post('/sessions/:id/score', requireRole('TEACHER', 'ADMIN'), async (c) => {
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      band: z.number().min(0).max(9).nullable(),
      feedback: z.string().max(4000).optional(),
    }),
  );
  const session = await setSpeakingBand(c.env, currentUser(c), c.req.param('id'), body);
  return c.json(session);
});

router.post('/sessions', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      topicSetId: z.string().min(1).max(64).optional(),
      mode: z.enum(['PRACTICE', 'MOCK']).optional(),
    }),
  );
  const session = await createSpeakingSession(c.env, user, body);
  return c.json(session, 201);
});

router.get('/sessions/:id', async (c) => {
  const session = await loadSpeakingSession(c.env, currentUser(c), c.req.param('id'));
  return c.json(session);
});

router.put('/sessions/:id/parts/:part', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const part = Number.parseInt(c.req.param('part'), 10);
  const body = await parseBody(
    c,
    z.object({
      transcript: z.string().max(20_000).optional(),
      durationSeconds: z.number().min(0).max(3600).optional(),
      audioBase64: z.string().max(8_000_000).nullable().optional(),
      mime: z.string().max(80).nullable().optional(),
    }),
  );
  const session = await saveSpeakingResponse(c.env, user, c.req.param('id'), { part, ...body });
  return c.json(session);
});

/** Submit + AI-mark in one call. `aiError` explains a missing provider. */
router.post('/sessions/:id/submit', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ providerId: z.string().max(64).optional() }).optional());
  const result = await submitSpeakingSession(c.env, user, c.req.param('id'), body ?? {});
  return c.json(result);
});

/** Re-mark with AI (staff only) — used after enabling a provider. */
router.post('/sessions/:id/ai-mark', requireRole('TEACHER', 'ADMIN'), async (c) => {
  const body = await parseBody(c, z.object({ providerId: z.string().max(64).optional() }).optional());
  const grade = await markSpeakingSessionAsStaff(c.env, c.req.param('id'), body ?? {});
  return c.json({ score: grade });
});

router.delete('/sessions/:id', async (c) => {
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await deleteSpeakingSession(c.env, currentUser(c), c.req.param('id'));
  return c.json({ ok: true });
});

/** Streams the candidate's own recording back for playback. */
router.get('/sessions/:id/audio/:part', async (c) => {
  // Ownership check first: a student may only hear their own recordings.
  await loadSpeakingSession(c.env, currentUser(c), c.req.param('id'));
  const audio = await loadSpeakingAudio(c.env, c.req.param('id'), Number.parseInt(c.req.param('part'), 10));
  if (!audio) throw ApiError.notFound('No recording was stored for that part.');

  const bytes = base64ToBytes(audio.base64);
  const range = parseRange(c.req.header('range') ?? null, bytes.byteLength);
  const headers: Record<string, string> = {
    'content-type': audio.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=0, no-store',
  };
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${bytes.byteLength}` } });
  }
  if (range) {
    const slice = bytes.slice(range.start, range.end + 1);
    return new Response(slice, {
      status: 206,
      headers: { ...headers, 'content-length': String(slice.byteLength), 'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}` },
    });
  }
  return new Response(bytes, { headers: { ...headers, 'content-length': String(bytes.byteLength) } });
});

export default router;
