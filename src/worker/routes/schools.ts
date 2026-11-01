import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import type { AppBindings } from '../env';
import { currentUser, requireAuth } from '../middleware/auth';
import { assertCsrf, assertSameOrigin } from '../lib/http';
import { parseBody } from '../lib/validate';
import { listLessonPlans, createLessonPlan, updateLessonPlan, deleteLessonPlan, listPlanVersions, mySubjectGroups, reviewAccess, submitLessonPlan, mySubmissions, reviewSubmissions, reviewLessonSubmission } from '../services/lesson-plan-service';
import { listSubjectGroups, saveSubjectGroup, deleteSubjectGroup, listSchoolEvents, saveSchoolEvent, deleteSchoolEvent, groupStaffDirectory } from '../services/school-operations-service';
import { schoolPermissions, listSchoolPermissions, setSchoolPermissions } from '../services/school-permissions';
import { enforceRateLimit } from '../lib/rate-limit';
import { listLessonAttachments, addLessonAttachment, removeLessonAttachment, readDraftAttachment, listSubmissionAttachments, readSubmissionAttachment } from '../services/lesson-attachment-service';
import { schoolOverview, eligibleSchoolClasses, setSchoolClassLink, getSchoolBanner, saveSchoolBanner, deleteSchoolBanner, transferSchoolClass, studentSchoolBanners } from '../services/school-insights-service';
import { createSchoolTeacher, isSchoolManager, canReviewSchoolApplications, listSchoolReviewers, grantSchoolReviewer, revokeSchoolReviewer, grantSchoolManager, listSchoolManagers, revokeSchoolManager, getSchoolLogo, inviteTeacher, listMySchools, listSchoolApplications, listSchoolMembers, registerSchool, removeSchoolMember, respondSchoolInvitation, reviewSchool, saveSchoolLogo } from '../services/school-service';

const router = new Hono<AppBindings>();
router.use('*', requireAuth, async (c, next) => { assertSameOrigin(c); if (!['GET', 'HEAD'].includes(c.req.method)) assertCsrf(c, c.get('session')?.csrfToken ?? null); await next(); });
router.get('/overview', async c => c.json({schools:await schoolOverview(c.env,currentUser(c))}));
router.get('/my-banners', async c => c.json({banners:await studentSchoolBanners(c.env,currentUser(c))}));
router.get('/:id/classroom-links', async c => c.json({classes:await eligibleSchoolClasses(c.env,currentUser(c),c.req.param('id'))}));
router.put('/:id/classroom-links/:classId', async c => {await setSchoolClassLink(c.env,currentUser(c),c.req.param('id'),c.req.param('classId'),true);return c.json({ok:true});});
router.post('/:id/classroom-links/:classId/transfer', async c => {const body=await parseBody(c,z.object({sourceSchoolId:z.string().min(1).max(100)}));await transferSchoolClass(c.env,currentUser(c),c.req.param('id'),c.req.param('classId'),body.sourceSchoolId);return c.json({ok:true});});
router.delete('/:id/classroom-links/:classId', async c => {await setSchoolClassLink(c.env,currentUser(c),c.req.param('id'),c.req.param('classId'),false);return c.json({ok:true});});
router.get('/:id/banner', async c => c.json({banner:await getSchoolBanner(c.env,currentUser(c),c.req.param('id'))}));
router.delete('/:id/banner', async c => {await deleteSchoolBanner(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});
router.put('/:id/banner', async c => {const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(120),message:z.string().trim().max(500),theme:z.enum(['blue','green','amber']),active:z.boolean(),image:z.object({mime:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().max(140000)}).nullable()}));await saveSchoolBanner(c.env,currentUser(c),c.req.param('id'),body);return c.json({ok:true});});
router.get('/access', async c => c.json({isManager:await isSchoolManager(c.env,currentUser(c)),canReviewSchools:await canReviewSchoolApplications(c.env,currentUser(c))}));
router.get('/reviewers', async c => c.json({reviewers:await listSchoolReviewers(c.env,currentUser(c))}));
router.post('/reviewers', async c => {const body=await parseBody(c,z.object({email:z.string().trim().email().max(254)}));await grantSchoolReviewer(c.env,currentUser(c),body.email);return c.json({ok:true});});
router.delete('/reviewers/:userId', async c => {await revokeSchoolReviewer(c.env,currentUser(c),c.req.param('userId'));return c.json({ok:true});});
router.get('/managers', async c => c.json({managers:await listSchoolManagers(c.env,currentUser(c))}));
router.post('/managers', async c => { const body=await parseBody(c,z.object({email:z.string().trim().email().max(254)})); await grantSchoolManager(c.env,currentUser(c),body.email); return c.json({ok:true}); });
router.delete('/managers/:userId', async c => {await revokeSchoolManager(c.env,currentUser(c),c.req.param('userId'));return c.json({ok:true});});
router.get('/', async (c) => c.json({ schools: await listMySchools(c.env, currentUser(c)) }));
router.post('/', async (c) => {
  const user = currentUser(c);
  if (!await isSchoolManager(c.env,user)) throw ApiError.forbidden('Chỉ giáo viên, admin hoặc mentor được cấp quyền mới có thể đăng ký trường.');
  await enforceRateLimit(c.env, { bucket: `school-register:${user.id}`, limit: 5, windowSeconds: 3600 }, 'Quá nhiều đăng ký, vui lòng thử lại sau.');
  const body = await parseBody(c, z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().min(3).max(300), contactEmail: z.string().trim().email().max(254) }));
  return c.json({ school: await registerSchool(c.env, user, body) }, 201);
});
router.get('/applications', async (c) => c.json({ schools: await listSchoolApplications(c.env, currentUser(c)) }));
router.post('/:id/review', async (c) => {
  const body = await parseBody(c, z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).default('') }));
  await reviewSchool(c.env, currentUser(c), c.req.param('id'), body.status, body.note); return c.json({ ok: true });
});
router.get('/:id/my-permissions',async c=>c.json({permissions:await schoolPermissions(c.env,currentUser(c),c.req.param('id'))}));
router.get('/:id/staff-permissions',async c=>c.json({permissions:await listSchoolPermissions(c.env,currentUser(c),c.req.param('id'))}));
router.put('/:id/staff-permissions/:userId',async c=>{const body=await parseBody(c,z.object({permissions:z.array(z.enum(['MANAGE_GROUPS','MANAGE_CALENDAR','REVIEW_ALL'])).max(3)}));await setSchoolPermissions(c.env,currentUser(c),c.req.param('id'),c.req.param('userId'),body.permissions);return c.json({ok:true});});
router.get('/:id/group-staff-directory',async c=>c.json({members:await groupStaffDirectory(c.env,currentUser(c),c.req.param('id'))}));
const groupSchema = z.object({ name:z.string().trim().min(1).max(120), leaderId:z.string().min(1).max(64).nullable(), memberIds:z.array(z.string().min(1).max(64)).max(200) });
router.get('/:id/subject-groups', async c=>c.json({groups:await listSubjectGroups(c.env,currentUser(c),c.req.param('id'))}));
router.post('/:id/subject-groups', async c=>c.json({group:await saveSubjectGroup(c.env,currentUser(c),c.req.param('id'),null,await parseBody(c,groupSchema))},201));
router.put('/:id/subject-groups/:groupId', async c=>c.json({group:await saveSubjectGroup(c.env,currentUser(c),c.req.param('id'),c.req.param('groupId'),await parseBody(c,groupSchema))}));
router.delete('/:id/subject-groups/:groupId', async c=>{await deleteSubjectGroup(c.env,currentUser(c),c.req.param('id'),c.req.param('groupId'));return c.json({ok:true});});
const eventSchema=z.object({title:z.string().trim().min(1).max(200),description:z.string().trim().max(5000).default(''),startsAt:z.string().datetime(),endsAt:z.string().datetime()});
router.get('/:id/events',async c=>c.json({events:await listSchoolEvents(c.env,currentUser(c),c.req.param('id'))}));
router.post('/:id/events',async c=>c.json({event:await saveSchoolEvent(c.env,currentUser(c),c.req.param('id'),null,await parseBody(c,eventSchema))},201));
router.put('/:id/events/:eventId',async c=>c.json({event:await saveSchoolEvent(c.env,currentUser(c),c.req.param('id'),c.req.param('eventId'),await parseBody(c,eventSchema))}));
router.delete('/:id/events/:eventId',async c=>{await deleteSchoolEvent(c.env,currentUser(c),c.req.param('id'),c.req.param('eventId'));return c.json({ok:true});});
const lessonPlanSchema = z.object({
  title: z.string().trim().min(1).max(200), subject: z.string().trim().max(120).default(''),
  week: z.number().int().min(1).max(53).nullable().default(null), content: z.string().max(30000).default(''),
});
router.get('/:id/my-subject-groups',async c=>c.json({groups:await mySubjectGroups(c.env,currentUser(c),c.req.param('id'))}));
router.get('/:id/lesson-review-access',async c=>c.json({canReview:await reviewAccess(c.env,currentUser(c),c.req.param('id'))}));
router.get('/:id/lesson-reviews/:submissionId/attachments',async c=>c.json({files:await listSubmissionAttachments(c.env,currentUser(c),c.req.param('id'),c.req.param('submissionId'))}));
router.get('/:id/lesson-reviews/:submissionId/attachments/:fileId',async c=>c.json({file:await readSubmissionAttachment(c.env,currentUser(c),c.req.param('id'),c.req.param('submissionId'),c.req.param('fileId'))}));
router.get('/:id/lesson-plans/:planId/attachments',async c=>c.json({files:await listLessonAttachments(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'))}));
router.post('/:id/lesson-plans/:planId/attachments',async c=>{const body=await parseBody(c,z.object({filename:z.string().min(1).max(160),base64:z.string().min(4).max(683000)}));return c.json(await addLessonAttachment(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'),body.filename,body.base64),201);});
router.delete('/:id/lesson-plans/:planId/attachments/:fileId',async c=>{await removeLessonAttachment(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'),c.req.param('fileId'));return c.json({ok:true});});
router.get('/:id/lesson-plans/:planId/attachments/:fileId',async c=>c.json({file:await readDraftAttachment(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'),c.req.param('fileId'))}));
router.get('/:id/lesson-reviews',async c=>c.json({submissions:await reviewSubmissions(c.env,currentUser(c),c.req.param('id'))}));
router.post('/:id/lesson-reviews/:submissionId',async c=>{const body=await parseBody(c,z.object({status:z.enum(['APPROVED','RETURNED']),comment:z.string().trim().max(5000).default('')}));await reviewLessonSubmission(c.env,currentUser(c),c.req.param('id'),c.req.param('submissionId'),body.status,body.comment);return c.json({ok:true});});
router.get('/:id/lesson-plans/:planId/versions',async c=>c.json({versions:await listPlanVersions(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'))}));
router.get('/:id/lesson-plans/:planId/submissions',async c=>c.json({submissions:await mySubmissions(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'))}));
router.post('/:id/lesson-plans/:planId/submit',async c=>{const body=await parseBody(c,z.object({groupId:z.string().min(1).max(64)}));await submitLessonPlan(c.env,currentUser(c),c.req.param('id'),c.req.param('planId'),body.groupId);return c.json({ok:true});});
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
