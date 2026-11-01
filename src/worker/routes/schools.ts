import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { currentUser, requireAuth } from '../middleware/auth';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { enforceRateLimit } from '../lib/rate-limit';
import { getSchoolLogo, inviteTeacher, listMySchools, listSchoolApplications, listSchoolMembers, registerSchool, removeSchoolMember, respondSchoolInvitation, reviewSchool, saveSchoolLogo } from '../services/school-service';

const router = new Hono<AppBindings>();
router.use('*', requireAuth, async (c, next) => { assertSameOrigin(c); if (!['GET', 'HEAD'].includes(c.req.method)) assertCsrf(c, c.get('session')?.csrfToken ?? null); await next(); });
router.get('/', async (c) => c.json({ schools: await listMySchools(c.env, currentUser(c)) }));
router.post('/', async (c) => {
  const user = currentUser(c);
  await enforceRateLimit(c.env, { bucket: `school-register:${user.id}`, limit: 5, windowSeconds: 3600 }, 'Quá nhiều đăng ký, vui lòng thử lại sau.');
  const body = await parseBody(c, z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(300), contactEmail: z.string().trim().email().max(254) }));
  return c.json({ school: await registerSchool(c.env, user, body) }, 201);
});
router.get('/applications', async (c) => c.json({ schools: await listSchoolApplications(c.env, currentUser(c)) }));
router.post('/:id/review', async (c) => {
  const body = await parseBody(c, z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).default('') }));
  await reviewSchool(c.env, currentUser(c), c.req.param('id'), body.status, body.note); return c.json({ ok: true });
});
router.get('/:id/logo', async (c) => { c.header('Cache-Control', 'private, no-store'); return c.json({ logo: await getSchoolLogo(c.env, c.req.param('id')) }); });
router.post('/:id/logo', async (c) => {
  const body = await parseBody(c, z.object({ mime: z.enum(['image/png','image/jpeg','image/webp']), base64: z.string().min(1).max(140000) }));
  await saveSchoolLogo(c.env, currentUser(c), c.req.param('id'), body.mime, body.base64); return c.json({ok:true});
});
router.get('/:id/members', async (c) => c.json({ members: await listSchoolMembers(c.env, currentUser(c), c.req.param('id')) }));
router.post('/:id/invite', async (c) => {
  const user = currentUser(c); await enforceRateLimit(c.env, { bucket: `school-invite:${user.id}`, limit: 30, windowSeconds: 3600 }, 'Quá nhiều lời mời, vui lòng thử lại sau.');
  const body = await parseBody(c, z.object({ email: z.string().trim().email().max(254) }));
  await inviteTeacher(c.env, user, c.req.param('id'), body.email); return c.json({ ok: true });
});
router.post('/:id/members/:userId/remove', async (c) => {
  await removeSchoolMember(c.env, currentUser(c), c.req.param('id'), c.req.param('userId')); return c.json({ ok: true });
});
router.post('/:id/respond', async (c) => {
  const body = await parseBody(c, z.object({ accept: z.boolean() }));
  await respondSchoolInvitation(c.env, currentUser(c), c.req.param('id'), body.accept); return c.json({ ok: true });
});
export default router;
