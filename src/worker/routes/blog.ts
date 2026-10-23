/**
 * Blog routes. Reading is public — the list and a post load for anyone —
 * while writing needs a mentor or admin session and commenting any session.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { currentUser } from '../middleware/auth';
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listManageablePosts,
  listPublishedPosts,
  setPublished,
  updatePost,
} from '../services/blog-service';

const router = new Hono<AppBindings>();

router.get('/', async (c) => c.json(await listPublishedPosts(c.env)));
router.get('/manage', async (c) => {
  const viewer = c.get('user');
  if (!viewer) return c.json({ posts: [] });
  return c.json(await listManageablePosts(c.env, viewer));
});
router.get('/:slug', async (c) => c.json({ post: await getPost(c.env, c.req.param('slug'), c.get('user')) }));

router.post('/', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().min(3).max(160),
      excerpt: z.string().max(400).optional().default(''),
      body_md: z.string().min(1).max(60_000),
    }),
  );
  return c.json({ post: await createPost(c.env, user, body) }, 201);
});

router.patch('/:id', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      title: z.string().min(3).max(160).optional(),
      excerpt: z.string().max(400).optional(),
      body_md: z.string().min(1).max(60_000).optional(),
    }),
  );
  return c.json({ post: await updatePost(c.env, user, c.req.param('id'), body) });
});

router.post('/:id/publish', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ published: z.boolean() }));
  return c.json({ post: await setPublished(c.env, user, c.req.param('id'), body.published) });
});

router.delete('/:id', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await deletePost(c.env, user, c.req.param('id')));
});

router.post('/:slug/comments', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ body: z.string().min(1).max(4000) }));
  return c.json({ comment: await addComment(c.env, user, c.req.param('slug'), body.body) }, 201);
});

router.delete('/comments/:id', async (c) => {
  assertSameOrigin(c);
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  return c.json(await deleteComment(c.env, user, c.req.param('id')));
});

export default router;
