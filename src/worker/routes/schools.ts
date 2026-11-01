import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import type { AppBindings } from '../env';
import { currentUser, requireAuth } from '../middleware/auth';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { listLessonPlans, createLessonPlan, updateLessonPlan, deleteLessonPlan } from '../services/lesson-plan-service';
import { enforceRateLimit } from '../lib/rate-limit';
import { createSchoolTeacher, isSchoolManager, grantSchoolManager, listSchoolManagers, revokeSchoolManager, getSchoolLogo, inviteTeacher, listMySchools, listSchoolApplications, listSchoolMembers, registerSchool, removeSchoolMember, respondSchoolInvitation, reviewSchool, saveSchoolLogo } from '../services/school-service';

const router = new Hono<AppBindings>();
router.use('*', requireAuth, async (c, next) => { assertSameOrigin(c); if (!['GET', 'HEAD'].includes(c.req.method)) assertCsrf(c, c.get('session')?.csrfToken ?? null); await next(); });
router.get('/access', async c => c.json({isManager:await isSchoolManager(c.env,currentUser(c))}));
router.get('/managers', async c => c.json({managers:await listSchoolManagers(c.env,currentUser(c))}));
router.post('/managers', async c => { const body=await parseBody(c,z.object({email:z.string().trim().email().max(254)})); await grantSchoolManager(c.env,currentUser(c),body.email); return c.json({ok:true}); });
router.delete('/managers/:userId', async c => {await revokeSchoolManager(c.env,currentUser(c),c.req.param('userId'));return c.json({ok:true});});
router.get('/', async (c) => c.json({ schools: await listMySchools(c.env, currentUser(c)) }));
router.post('/', async (c) => {
  const user = currentUser(c);
  if (!await isSchoolManager(c.env,user)) throw ApiError.forbidden('Chỉ tài khoản quản lý trường mới có thể đăng ký trường.');
  await enforceRateLimit(c.env, { bucket: `school-register:${user.id}`, limit: 5, windowSeconds: 3600 }, 'Quá nhiều đăng ký, vui lòng thử lại sau.');
  const body = await parseBody(c, z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(300), contactEmail: z.string().trim().email().max(254) }));
  return c.json({ school: await registerSchool(c.env, user, body) }, 201);
});
router.get('/applications', async (c) => c.json({ schools: await listSchoolApplications(c.env, currentUser(c)) }));
router.post('/:id/review', async (c) => {
  const body = await parseBody(c, z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).default('') }));
  await reviewSchool(c.env, currentUser(c), c.req.param('id'), body.status, body.note); return c.json({ ok: true });
});
const lessonPlanSchema = z.object({
  title: z.string().trim().min(1).max(200), subject: z.string().trim().max(120).default(''),
  week: z.number().int().min(1).max(53).nullable().default(null), content: z.string().max(30000).default(''),
});
router.get('/:id/lesson-plans', async c => c.json({ plans: await listLessonPlans(c.env, currentUser(c), c.req.param('id')) }));
router.post('/:id/lesson-plans', async c => {
  const body = await parseBody(c, lessonPlanSchema);
  return c.json({ plan: await createLessonPlan(c.env, currentUser(c), c.req.param('id'), body) }, 201);
});
router.patch('/:id/lesson-plans/:planId', async c => {
  const body = await parseBody(c, lessonPlanSchema);
  await updateLessonPlan(c.env, currentUser(c), c.req.param('id'), c.req.param('planId'), body); return c.json({ ok: true });
});
router.delete('/:id/lesson-plans/:planId', async c => {
  await deleteLessonPlan(c.env, currentUser(c), c.req.param('id'), c.req.param('planId')); return c.json({ ok: true });
});
router.get('/:id/logo', async (c) => { c.header('Cache-Control', 'private, no-store'); return c.json({ logo: await getSchoolLogo(c.env, c.req.param('id')) }); });
router.post('/:id/logo', async (c) => {
  const body = await parseBody(c, z.object({ mime: z.enum(['image/png','image/jpeg','image/webp']), base64: z.string().min(1).max(140000) }));
  await saveSchoolLogo(c.env, currentUser(c), c.req.param('id'), body.mime, body.base64); return c.json({ok:true});
});
router.get('/:id/members', async (c) => c.json({ members: await listSchoolMembers(c.env, currentUser(c), c.req.param('id')) }));
router.post('/:id/teachers', async c => {
  const user=currentUser(c);
  await enforceRateLimit(c.env,{bucket:`school-teacher-create:${user.id}`,limit:20,windowSeconds:3600},'Quá nhiều tài khoản mới.');
  const body=await parseBody(c,z.object({email:z.string().trim().toLowerCase().email().max(254),displayName:z.string().trim().min(1).max(120),password:z.string().min(10).max(200)}));
  return c.json({teacher:await createSchoolTeacher(c.env,user,c.req.param('id'),body)},201);
});
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
