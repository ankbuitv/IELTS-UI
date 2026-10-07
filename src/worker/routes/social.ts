import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { enforceRateLimit } from '../lib/rate-limit';
import { parseBody, parseQuery } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import {
  getFriends,
  getPublicProfile,
  removeFriend,
  respondToFriendRequest,
  searchPeople,
  sendFriendRequest,
  updateSocialProfile,
} from '../services/social-service';
import { PROFILE_AVATARS, PROFILE_BANNERS, PROFILE_EFFECTS, PROFILE_NAME_COLORS } from '../../shared/social';

export const socialRouter = new Hono<AppBindings>();
socialRouter.use('*', requireAuth);
socialRouter.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});

socialRouter.get('/me', async (c) => {
  const user = currentUser(c);
  return c.json({ profile: await getPublicProfile(c.env, user.id, true) });
});

socialRouter.patch('/me', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z
      .object({
        displayName: z.string().trim().min(1).max(40).optional(),
        avatarKey: z.enum(PROFILE_AVATARS).optional(),
        bannerKey: z.enum(PROFILE_BANNERS).optional(),
        usernameColor: z.enum(PROFILE_NAME_COLORS).optional(),
        profileEffect: z.enum(PROFILE_EFFECTS).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, 'Choose at least one profile field to update.'),
  );
  await updateSocialProfile(c.env, user.id, body);
  return c.json({ profile: await getPublicProfile(c.env, user.id, true) });
});

socialRouter.get('/people', async (c) => {
  const user = currentUser(c);
  const { q } = parseQuery(c, z.object({ q: z.string().trim().max(80).default('') }));
  if (q.trim().length < 2) return c.json({ people: [] });
  await enforceRateLimit(
    c.env,
    { bucket: `social-search:${user.id}`, windowSeconds: 3600, limit: 120 },
    'You have searched for a lot of people this hour. Try again later.',
  );
  return c.json({ people: await searchPeople(c.env, user.id, q) });
});

socialRouter.get('/friends', async (c) => {
  const user = currentUser(c);
  return c.json(await getFriends(c.env, user.id));
});

socialRouter.post('/friends/requests', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await enforceRateLimit(
    c.env,
    { bucket: `social-request:${user.id}`, windowSeconds: 3600, limit: 40 },
    'You have sent a lot of friend requests this hour. Try again later.',
  );
  const body = await parseBody(c, z.object({ userId: z.string().trim().min(1).max(100) }));
  await sendFriendRequest(c.env, user.id, body.userId);
  return c.json({ ok: true });
});

socialRouter.post('/friends/requests/:requestId/respond', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ accept: z.boolean() }));
  const requestId = c.req.param('requestId');
  if (requestId.length > 100) throw ApiError.validation('That friend request is invalid.');
  await respondToFriendRequest(c.env, user.id, requestId, body.accept);
  return c.json({ ok: true });
});

socialRouter.delete('/friends/:userId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const targetId = c.req.param('userId');
  if (targetId.length > 100) throw ApiError.validation('That profile is invalid.');
  await removeFriend(c.env, user.id, targetId);
  return c.json({ ok: true });
});

socialRouter.get('/profiles/:userId', async (c) => {
  const user = currentUser(c);
  const profileId = c.req.param('userId');
  if (profileId.length > 100) throw ApiError.validation('That profile is invalid.');
  return c.json({ profile: await getPublicProfile(c.env, profileId, profileId === user.id) });
});
