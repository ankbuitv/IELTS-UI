import {resourceBackupSchema,exportResourceBackup,restoreResourceBackup} from '../services/resource-backup';
import {questionBackupSchema,exportQuestionBackup,restoreQuestionBackup} from '../services/question-bank-backup';
import {assignmentBackupConfigSchema,teacherBackupSchema,exportTeacherBackup,restoreTeacherBackup,retentionSettings,setRetention,pruneTeacherTasks,noteRetentionSettings,setNoteRetention,pruneTeacherNotes} from '../services/teacher-data-controls';
import {listExtensions,setExtension} from '../services/assignment-extensions';
import {listTaskDelegations,delegateTask,revokeTaskDelegation,changeDelegatedTask,declineTask} from '../services/teacher-task-delegation';
import {readWorksheetSubmissionFile} from '../services/class-worksheet-service';
import {setQuestionMedia,deleteQuestionMedia,getQuestionMedia,getWorksheetMedia} from '../services/question-media';
import {listReportTemplates,saveReportTemplate,deleteReportTemplate} from '../services/report-templates';
import {listAssignmentHistory} from '../services/assignment-history';
import {calendarSubscriptionStatus,rotateCalendarSubscription,revokeCalendarSubscription} from '../services/teacher-calendar-subscription';
import {listInterventions,createIntervention,updateIntervention,deleteIntervention} from '../services/teacher-interventions';
import {classQuestionAnalysis} from '../services/class-question-analysis';
import {classPeriodComparison} from '../services/class-period-comparison';
import {classPracticeBalance} from '../services/class-practice-balance';
import {listClassGoals,saveClassGoal,deleteClassGoal} from '../services/classroom-goals';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { describeAiFailure } from '../ai/failure';
import { ApiError } from '../lib/errors';
import { assertCsrf, assertSameOrigin, clientIp } from '../lib/http';
import { parseBody, parseWith } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { currentUser } from '../middleware/auth';
import {
  acceptClassroomInvite,
  addMemberByEmail,
  archiveAssignment,
  createAssignment,
  createClassroom,
  createClassroomInvite,
  getAssignmentDetail,
  listAssignmentsForClassroom,
  listClassroomMembers,
  listClassroomsForTeacher,
  listInvites,
  removeMember,
  requireClassroomAccess,
  requireStudentAccess,
  revokeInvite,
  updateAssignment,
  updateClassroom,
} from '../services/teacher-service';
import {getTeacherAvailability,saveTeacherAvailability} from '../services/teacher-availability-service';
import {listTeacherTasks,createTeacherTask,updateTeacherTask,deleteTeacherTask,readDailyNote,saveDailyNote} from '../services/teacher-tasks-service';
import {cloneAssignmentToClasses} from '../services/assignment-clone-service';
import {listAssignmentTemplates,saveAssignmentTemplate,deleteAssignmentTemplate} from '../services/teacher-assignment-templates';
import {teacherScheduleConflicts} from '../services/teacher-schedule-conflicts';
import {searchTeacherWorkspace} from '../services/teacher-workspace-search';
import {setQuestionFeedback} from '../services/question-feedback-service';
import {listTeachingSchedule,createTeachingEvent,updateTeachingEvent,moveTeachingEvent,deleteTeachingEvent} from '../services/class-teaching-schedule-service';
import {teacherWritingReview,saveWritingReview,writingFeedbackDiscussion,addWritingFeedbackMessage} from '../services/writing-revision-service';
import {createWorksheet,listTeacherWorksheets,teacherWorksheetDetail,teacherWorksheetVersions,closeWorksheet,saveWorksheetFeedback} from '../services/class-worksheet-service';
import {listRubrics,createRubric,updateRubric,deleteRubric} from '../services/teacher-rubrics-service';
import {classDuties,listDuties,setDuties,requireTeacherAttempt} from '../services/co-teacher-duties-service';
import {listTeacherSupport,createSupportSlot,cancelTeacherSlot} from '../services/teacher-support-service';
import {setMarkingDeadline} from '../services/marking-deadline-service';
import {teacherAttemptScope} from '../services/teacher-attempt-scope';
import { getClassroomAnalytics, getSkillPerformance, getTaskTypePerformance, getTrends, listAttempts } from '../services/analytics-service';
import { buildResultView } from '../services/attempt-service';
import { listWritingQueue, markQuestionManually, setWritingScore } from '../services/marking-service';
import { loadWritingMarks, scoreWritingSubmissionWithAi } from '../services/ai-marking-service';
import { recordAudit } from '../lib/audit';
import { teacherProgress } from '../services/teacher-progress-service';
import { readAttendance, saveAttendance, attendanceTrend } from '../services/teacher-attendance-service';
import { classroomGradebook } from '../services/teacher-gradebook-service';
import {readTermReport,saveTermReport,releaseTermReport} from '../services/class-term-report-service';
import {classStudentProgress} from '../services/teacher-student-progress-service';
import {listResources,createResource,updateResource,deleteResource,readOwnResource,resourceAudience} from '../services/teacher-resources-service';
import { listQuestions,createQuestion,updateQuestion,deleteQuestion } from '../services/teacher-question-bank-service';
import { listFeedbackTemplates,createFeedbackTemplate,deleteFeedbackTemplate,updateFeedbackTemplate } from '../services/teacher-feedback-templates-service';
import { readSeating, saveSeating } from '../services/teacher-seating-service';
import { listPrivateNotes, savePrivateNote } from '../services/teacher-private-notes-service';
import { EXAM_MODES, RESULT_VISIBILITIES, TIMING_POLICIES } from '../../shared/types';

const router = new Hono<AppBindings>();

router.use('*', requireAuth, requireRole('TEACHER', 'ADMIN'));
router.use('*', async (c, next) => {
  assertSameOrigin(c);
  await next();
});
const classGoalSchema=z.object({title:z.string().trim().min(1).max(200),targetPercent:z.number().int().min(1).max(100),dueDate:z.string().length(10).nullable()});
router.get('/classrooms/:classroomId/question-analysis',async c=>c.json(await classQuestionAnalysis(c.env,currentUser(c),c.req.param('classroomId'))));
router.get('/classrooms/:classroomId/period-comparison',async c=>c.json(await classPeriodComparison(c.env,currentUser(c),c.req.param('classroomId'),c.req.query('aFrom')??'',c.req.query('aTo')??'',c.req.query('bFrom')??'',c.req.query('bTo')??'')));
router.get('/classrooms/:classroomId/practice-balance',async c=>c.json(await classPracticeBalance(c.env,currentUser(c),c.req.param('classroomId'),c.req.query('from')??'',c.req.query('to')??'')));
router.get('/classrooms/:classroomId/goals',async c=>c.json(await listClassGoals(c.env,currentUser(c),c.req.param('classroomId'))));
router.post('/classrooms/:classroomId/goals',async c=>c.json({goal:await saveClassGoal(c.env,currentUser(c),c.req.param('classroomId'),null,await parseBody(c,classGoalSchema))},201));
router.put('/classrooms/:classroomId/goals/:goalId',async c=>c.json({goal:await saveClassGoal(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('goalId'),await parseBody(c,classGoalSchema))}));
router.delete('/classrooms/:classroomId/goals/:goalId',async c=>{await deleteClassGoal(c.env,currentUser(c),c.req.param('classroomId'),c.req.param('goalId'));return c.json({ok:true});});


router.get('/search',async c=>c.json(await searchTeacherWorkspace(c.env,currentUser(c),c.req.query('q')??'')));

// ---------------------------------------------------------------------------
// Classrooms
// ---------------------------------------------------------------------------
const reportTemplateSchema=z.object({name:z.string().trim().min(1).max(100),title:z.string().trim().min(1).max(150),feedback:z.string().trim().max(4000)});
router.get('/report-templates',async c=>c.json({templates:await listReportTemplates(c.env,currentUser(c))}));
router.post('/report-templates',async c=>c.json({id:await saveReportTemplate(c.env,currentUser(c),null,await parseBody(c,reportTemplateSchema))},201));
router.put('/report-templates/:id',async c=>c.json({id:await saveReportTemplate(c.env,currentUser(c),c.req.param('id'),await parseBody(c,reportTemplateSchema))}));
router.delete('/report-templates/:id',async c=>{await deleteReportTemplate(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

const resourceMetadata=z.object({sensitivity:z.enum(['NORMAL','SENSITIVE']).optional(),subject:z.string().trim().max(120),topic:z.string().trim().max(120),classroomId:z.string().min(1).max(100).nullable()});
router.get('/resource-audience/:classId',async c=>c.json(await resourceAudience(c.env,currentUser(c),c.req.param('classId'))));
router.get('/resources',async c=>c.json({files:await listResources(c.env,currentUser(c))}));
router.post('/resources',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,resourceMetadata.extend({filename:z.string().min(1).max(160),base64:z.string().min(4).max(683000)}));return c.json({id:await createResource(c.env,currentUser(c),body)},201);});
router.put('/resources/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,resourceMetadata);await updateResource(c.env,currentUser(c),c.req.param('id'),body);return c.json({ok:true});});
router.delete('/resources/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteResource(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});
router.get('/resources/:id',async c=>c.json({file:await readOwnResource(c.env,currentUser(c),c.req.param('id'))}));

const questionSchema=z.object({skill:z.enum(['LISTENING','READING','WRITING','SPEAKING']),topic:z.string().trim().max(120),question:z.string().trim().min(1).max(5000),referenceAnswer:z.string().trim().max(5000),difficulty:z.enum(['UNSPECIFIED','EASY','MEDIUM','HARD']).optional(),questionType:z.enum(['TEXT','MULTIPLE_CHOICE']).default('TEXT'),options:z.array(z.string().trim().min(1).max(500)).max(6).default([]),correctIndex:z.number().int().min(0).max(5).nullable().default(null),contextText:z.string().trim().max(8000).default('')}).superRefine((q,ctx)=>{if(q.questionType==='MULTIPLE_CHOICE'&&(q.options.length<2||q.correctIndex===null||q.correctIndex>=q.options.length))ctx.addIssue({code:'custom',message:'Cần 2–6 lựa chọn và một đáp án đúng.'});if(q.questionType==='TEXT'&&(q.options.length||q.correctIndex!==null))ctx.addIssue({code:'custom',message:'Câu tự luận không có lựa chọn.'});});
const mediaKind=z.enum(['IMAGE','AUDIO']);
const mediaBody=z.object({mime:z.enum(['image/png','image/jpeg','image/webp','audio/mpeg','audio/ogg','audio/wav']),base64:z.string().min(4).max(682668),startSeconds:z.number().int().min(0).max(86400).default(0)});
router.get('/questions/:id/media/:kind',async c=>c.json({media:await getQuestionMedia(c.env,currentUser(c),c.req.param('id'),parseWith(mediaKind,c.req.param('kind')))}));
router.put('/questions/:id/media/:kind',async c=>{const b=await parseBody(c,mediaBody);await setQuestionMedia(c.env,currentUser(c),c.req.param('id'),parseWith(mediaKind,c.req.param('kind')),b.mime,b.base64,b.startSeconds);return c.json({ok:true});});
router.delete('/questions/:id/media/:kind',async c=>{await deleteQuestionMedia(c.env,currentUser(c),c.req.param('id'),parseWith(mediaKind,c.req.param('kind')));return c.json({ok:true});});
router.get('/classrooms/:id/worksheets/:worksheetId/questions/:questionId/media/:kind',async c=>c.json({media:await getWorksheetMedia(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'),c.req.param('questionId'),parseWith(mediaKind,c.req.param('kind')))}));
router.get('/questions',async c=>c.json({questions:await listQuestions(c.env,currentUser(c))}));
router.post('/questions',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,questionSchema);return c.json({id:await createQuestion(c.env,currentUser(c),body)},201);});
router.put('/questions/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,questionSchema);await updateQuestion(c.env,currentUser(c),c.req.param('id'),body);return c.json({ok:true});});
router.delete('/questions/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteQuestion(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

const rubricSchema=z.object({skill:z.enum(['WRITING','SPEAKING']),title:z.string().trim().min(1).max(100),criteria:z.array(z.string().trim().min(1).max(60)).min(1).max(8)});
router.get('/rubrics',async c=>{const skill=z.enum(['WRITING','SPEAKING']).safeParse(c.req.query('skill'));if(!skill.success)throw ApiError.validation('Kỹ năng không hợp lệ.');return c.json({rubrics:await listRubrics(c.env,currentUser(c),skill.data)});});
router.post('/rubrics',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json({id:await createRubric(c.env,currentUser(c),await parseBody(c,rubricSchema))},201);});
router.put('/rubrics/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await updateRubric(c.env,currentUser(c),c.req.param('id'),await parseBody(c,rubricSchema));return c.json({ok:true});});
router.delete('/rubrics/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteRubric(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

router.get('/feedback-templates',async c=>c.json({templates:await listFeedbackTemplates(c.env,currentUser(c))}));
router.post('/feedback-templates',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(3000)}));return c.json({id:await createFeedbackTemplate(c.env,currentUser(c),body.title,body.body)},201);});
router.put('/feedback-templates/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(3000)}));await updateFeedbackTemplate(c.env,currentUser(c),c.req.param('id'),body.title,body.body);return c.json({ok:true});});
router.delete('/feedback-templates/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteFeedbackTemplate(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

router.get('/progress', async c => c.json({assignments:await teacherProgress(c.env,currentUser(c))}));

router.get('/classrooms/:id/seating', async c=>c.json(await readSeating(c.env,currentUser(c),c.req.param('id'))));
router.put('/classrooms/:id/seating', async c=>{assertCsrf(c,c.get('session')?.csrfToken ?? null);const body=await parseBody(c,z.object({studentIds:z.array(z.string().min(1).max(100)).max(200)}));await saveSeating(c.env,currentUser(c),c.req.param('id'),body.studentIds);return c.json({ok:true});});

const interventionBody=z.object({occurredOn:z.string().length(10),action:z.string().trim().min(1).max(1000),outcome:z.string().max(1000)});
router.get('/classrooms/:id/interventions/:studentId',async c=>c.json({items:await listInterventions(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'))}));
router.post('/classrooms/:id/interventions/:studentId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json(await createIntervention(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),await parseBody(c,interventionBody)),201);});
router.put('/classrooms/:id/interventions/:studentId/:entryId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await updateIntervention(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),c.req.param('entryId'),await parseBody(c,interventionBody));return c.json({ok:true});});
router.delete('/classrooms/:id/interventions/:studentId/:entryId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteIntervention(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),c.req.param('entryId'));return c.json({ok:true});});
router.get('/classrooms/:id/private-notes', async c=>c.json(await listPrivateNotes(c.env,currentUser(c),c.req.param('id'))));
router.put('/classrooms/:id/private-notes/:studentId', async c=>{assertCsrf(c,c.get('session')?.csrfToken ?? null);const body=await parseBody(c,z.object({body:z.string().max(4000)}));await savePrivateNote(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),body.body);return c.json({ok:true});});

router.get('/classrooms/:id/schedule',async c=>c.json({events:await listTeachingSchedule(c.env,currentUser(c),c.req.param('id'))}));
const teachingOccurrence=z.object({startsAt:z.string().datetime(),endsAt:z.string().datetime()});
const teachingInput=teachingOccurrence.extend({title:z.string().trim().min(1).max(150),kind:z.enum(['REGULAR','MAKEUP']).optional(),note:z.string().trim().max(500).optional()});
router.post('/schedule-conflicts',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({intervals:z.array(teachingOccurrence).min(1).max(24),ignoreEventId:z.string().max(100).optional()}));return c.json({conflicts:await teacherScheduleConflicts(c.env,currentUser(c),body.intervals,body.ignoreEventId)});});
router.post('/classrooms/:id/schedule',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,teachingInput.extend({occurrences:z.array(teachingOccurrence).max(23).optional()}));return c.json(await createTeachingEvent(c.env,currentUser(c),c.req.param('id'),body),201);});
router.put('/classrooms/:id/schedule/:eventId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,teachingInput);await updateTeachingEvent(c.env,currentUser(c),c.req.param('id'),c.req.param('eventId'),body);return c.json({ok:true});});
router.patch('/classrooms/:id/schedule/:eventId/time',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,teachingOccurrence);await moveTeachingEvent(c.env,currentUser(c),c.req.param('id'),c.req.param('eventId'),body);return c.json({ok:true});});
router.delete('/classrooms/:id/schedule/:eventId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteTeachingEvent(c.env,currentUser(c),c.req.param('id'),c.req.param('eventId'));return c.json({ok:true});});

router.get('/classrooms/:id/worksheets',async c=>c.json({worksheets:await listTeacherWorksheets(c.env,currentUser(c),c.req.param('id'))}));
router.post('/classrooms/:id/worksheets',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(150),deadlineAt:z.string().datetime().nullable(),questionIds:z.array(z.string().min(1)).min(1).max(20),shuffleQuestions:z.boolean().default(false),shuffleOptions:z.boolean().default(false)}));return c.json(await createWorksheet(c.env,currentUser(c),c.req.param('id'),body),201);});
router.get('/classrooms/:id/worksheets/:worksheetId',async c=>c.json(await teacherWorksheetDetail(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'))));
router.get('/classrooms/:id/worksheets/:worksheetId/versions/:versionId/file',async c=>c.json({file:await readWorksheetSubmissionFile(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'),c.req.param('versionId'))}));
router.get('/classrooms/:id/worksheets/:worksheetId/students/:studentId',async c=>c.json({versions:await teacherWorksheetVersions(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'),c.req.param('studentId'))}));
router.post('/classrooms/:id/worksheets/:worksheetId/close',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await closeWorksheet(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'));return c.json({ok:true});});
router.put('/classrooms/:id/worksheets/:worksheetId/versions/:versionId/feedback',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({comments:z.array(z.object({questionId:z.string().min(1),start:z.number().int().min(0),end:z.number().int().min(0),text:z.string().trim().min(1).max(2000)})).max(100),publish:z.boolean()}));await saveWorksheetFeedback(c.env,currentUser(c),c.req.param('id'),c.req.param('worksheetId'),c.req.param('versionId'),body.comments,body.publish);return c.json({ok:true});});

router.get('/classrooms/:id/duties',async c=>c.json({members:await listDuties(c.env,currentUser(c),c.req.param('id'))}));
router.put('/classrooms/:id/duties/:userId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({grading:z.boolean(),attendance:z.boolean(),resources:z.boolean()}));await setDuties(c.env,currentUser(c),c.req.param('id'),c.req.param('userId'),body);return c.json({ok:true});});

router.get('/classrooms/:id/support',async c=>c.json({slots:await listTeacherSupport(c.env,currentUser(c),c.req.param('id'))}));
router.post('/classrooms/:id/support',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({startsAt:z.string().datetime(),endsAt:z.string().datetime()}));return c.json(await createSupportSlot(c.env,currentUser(c),c.req.param('id'),body.startsAt,body.endsAt),201);});
router.delete('/classrooms/:id/support/:slotId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await cancelTeacherSlot(c.env,currentUser(c),c.req.param('id'),c.req.param('slotId'));return c.json({ok:true});});

router.get('/classrooms/:id/term-reports/:studentId',async c=>c.json(await readTermReport(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'))));
router.put('/classrooms/:id/term-reports/:studentId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({title:z.string().trim().min(1).max(150),fromDate:z.string().length(10),toDate:z.string().length(10),feedback:z.string().trim().max(4000)}));await saveTermReport(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),body);return c.json({ok:true});});
router.post('/classrooms/:id/term-reports/:studentId/release',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json(await releaseTermReport(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId')),201);});

router.get('/classrooms/:id/student-progress/:studentId',async c=>c.json(await classStudentProgress(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'))));

router.get('/classrooms/:id/gradebook', async c=>c.json(await classroomGradebook(c.env,currentUser(c),c.req.param('id'))));
router.get('/classrooms/:id/attendance-trend',async c=>c.json({rows:await attendanceTrend(c.env,currentUser(c),c.req.param('id'),c.req.query('from')??'',c.req.query('to')??'')}));
router.get('/classrooms/:id/attendance', async c=>c.json(await readAttendance(c.env,currentUser(c),c.req.param('id'),c.req.query('date')??'')));
router.put('/classrooms/:id/attendance', async c=>{assertCsrf(c,c.get('session')?.csrfToken ?? null);const body=await parseBody(c,z.object({date:z.string().length(10),rows:z.array(z.object({studentId:z.string().min(1).max(100),status:z.enum(['PRESENT','ABSENT','LATE','UNMARKED'])})).max(500)}));await saveAttendance(c.env,currentUser(c),c.req.param('id'),body.date,body.rows);return c.json({ok:true});});

router.get('/classrooms', async (c) => {
  const user = currentUser(c);
  return c.json({ classrooms: await listClassroomsForTeacher(c.env, user) });
});

router.post('/classrooms', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).optional() }),
  );
  const classroom = await createClassroom(c.env, user, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_CREATE',
    entityType: 'classroom',
    entityId: classroom.id,
    ip: clientIp(c),
  });
  return c.json({ classroom }, 201);
});

router.get('/classrooms/:id', async (c) => {
  const user = currentUser(c);
  const classroomId = c.req.param('id');
  const classroom = await requireClassroomAccess(c.env, user, classroomId);
  const [members, assignments, invites, analytics, duties] = await Promise.all([
    listClassroomMembers(c.env, classroomId),
    listAssignmentsForClassroom(c.env, classroomId),
    listInvites(c.env, classroomId),
    getClassroomAnalytics(c.env, classroomId),
    classDuties(c.env,user,classroomId),
  ]);
  return c.json({
    classroom: {
      id: classroom.id,
      name: classroom.name,
      description: (await c.env.DB.prepare('SELECT description FROM classrooms WHERE id=?').bind(classroomId).first<{ description: string }>())?.description ?? '',
      status: classroom.status,
      isOwner: classroom.teacher_id === user.id,
      duties,
    },
    members,
    assignments,
    invites,
    analytics,
  });
});

router.patch('/classrooms/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    }),
  );
  await updateClassroom(c.env, user, c.req.param('id'), body);
  return c.json({ ok: true });
});

router.post('/classrooms/:id/archive', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await updateClassroom(c.env, user, c.req.param('id'), { status: 'ARCHIVED' });
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_ARCHIVE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------
router.get('/classrooms/:id/members', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  return c.json({ members: await listClassroomMembers(c.env, c.req.param('id')) });
});

router.post('/classrooms/:id/invites', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
      ttlHours: z.number().int().min(1).max(720).optional(),
    }),
  );
  const invite = await createClassroomInvite(c.env, user, c.req.param('id'), body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_INVITE_CREATE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    metadata: { inviteId: invite.inviteId, email: invite.email },
    ip: clientIp(c),
  });

  const base = (c.env.APP_BASE_URL || 'https://ielts.ankb.qzz.io').replace(/\/$/, '');
  return c.json({
    invite,
    shareUrl: `${base}/join?token=${encodeURIComponent(invite.token)}`,
  }, 201);
});

router.delete('/classrooms/:id/invites/:inviteId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await revokeInvite(c.env, user, c.req.param('id'), c.req.param('inviteId'));
  return c.json({ ok: true });
});

router.post('/classrooms/:id/members', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ email: z.string().trim().toLowerCase().email().max(254) }));
  const member = await addMemberByEmail(c.env, user, c.req.param('id'), body.email);
  return c.json({ member }, 201);
});

router.delete('/classrooms/:id/members/:userId', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await removeMember(c.env, user, c.req.param('id'), c.req.param('userId'));
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'CLASSROOM_MEMBER_REMOVE',
    entityType: 'classroom',
    entityId: c.req.param('id'),
    metadata: { removedUserId: c.req.param('userId') },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/** Accepting an invitation as a teacher/co-teacher (students use /classrooms/join). */
router.post('/invites/accept', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, z.object({ token: z.string().min(10).max(200) }));
  const result = await acceptClassroomInvite(c.env, user, body.token);
  return c.json({ ok: true, ...result });
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------
const assignmentSchema = z.object({
  classroomId: z.string().min(1),
  testVersionId: z.string().min(1),
  title: z.string().trim().max(200).optional(),
  instructions: z.string().max(4000).optional(),
  startAt: z.string().datetime().nullable().optional(),
  deadlineAt: z.string().datetime().nullable().optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
  timingPolicy: z.enum(TIMING_POLICIES).optional(),
  customDurationSeconds: z.number().int().min(60).max(36_000).nullable().optional(),
  mode: z.enum(EXAM_MODES).optional(),
  integrityOverrides: z.record(z.string(), z.union([z.boolean(), z.number(), z.null()])).optional(),
  resultVisibility: z.enum(RESULT_VISIBILITIES).optional(),
  publish: z.boolean().optional(),
  studentIds: z.array(z.string().min(1)).min(1).max(200).optional(),
});

const assignmentTemplateSchema=z.object({name:z.string().trim().min(1).max(100),config:assignmentBackupConfigSchema});
router.get('/assignment-templates',async c=>c.json({templates:await listAssignmentTemplates(c.env,currentUser(c))}));
router.post('/assignment-templates',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json({id:await saveAssignmentTemplate(c.env,currentUser(c),await parseBody(c,assignmentTemplateSchema))},201);});
router.put('/assignment-templates/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await saveAssignmentTemplate(c.env,currentUser(c),await parseBody(c,assignmentTemplateSchema),c.req.param('id'));return c.json({ok:true});});
router.delete('/assignment-templates/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteAssignmentTemplate(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

const taskSchema=z.object({title:z.string().trim().min(1).max(200),dueDate:z.string().length(10).nullable(),priority:z.enum(['HIGH','NORMAL','LOW'])});
router.get('/availability',async c=>c.json({availability:await getTeacherAvailability(c.env,currentUser(c))}));
router.put('/availability',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({timezone:z.string().min(1).max(100),slots:z.array(z.object({day:z.number().int().min(0).max(6),start:z.string().length(5),end:z.string().length(5)})).max(7)}));await saveTeacherAvailability(c.env,currentUser(c),body.timezone,body.slots);return c.json({ok:true});});
router.get('/daily-notes/:day',async c=>c.json(await readDailyNote(c.env,currentUser(c),c.req.param('day'))));
router.put('/daily-notes/:day',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({body:z.string().max(4000)}));await saveDailyNote(c.env,currentUser(c),c.req.param('day'),body.body);return c.json({ok:true});});
router.get('/calendar-subscription',async c=>c.json({active:await calendarSubscriptionStatus(c.env,currentUser(c))}));
router.post('/calendar-subscription',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json({token:await rotateCalendarSubscription(c.env,currentUser(c))});});
router.delete('/calendar-subscription',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await revokeCalendarSubscription(c.env,currentUser(c));return c.json({ok:true});});
router.get('/resource-backup',async c=>{const offset=parseWith(z.coerce.number().int().min(0).max(25),c.req.query('offset')??0);c.header('Cache-Control','private, no-store');return c.json(await exportResourceBackup(c.env,currentUser(c),offset));});
router.post('/resource-backup/restore',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);if(Number(c.req.header('content-length')??0)>4_000_000)throw ApiError.validation('Tệp vượt 4 MB.');const text=await c.req.text();if(new TextEncoder().encode(text).byteLength>4_000_000)throw ApiError.validation('Tệp vượt 4 MB.');let raw:unknown;try{raw=JSON.parse(text);}catch{throw ApiError.validation('Tệp JSON không hợp lệ.');}return c.json(await restoreResourceBackup(c.env,currentUser(c),parseWith(resourceBackupSchema,raw)));});
router.get('/question-bank-backup',async c=>{const offset=parseWith(z.coerce.number().int().min(0).max(500),c.req.query('offset')??0);c.header('Cache-Control','private, no-store');return c.json(await exportQuestionBackup(c.env,currentUser(c),offset));});
router.post('/question-bank-backup/restore',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);if(Number(c.req.header('content-length')??0)>8_000_000)throw ApiError.validation('Tệp vượt 8 MB.');const text=await c.req.text();if(new TextEncoder().encode(text).byteLength>8_000_000)throw ApiError.validation('Tệp vượt 8 MB.');let raw:unknown;try{raw=JSON.parse(text);}catch{throw ApiError.validation('Tệp JSON không hợp lệ.');}return c.json(await restoreQuestionBackup(c.env,currentUser(c),parseWith(questionBackupSchema,raw)));});
router.get('/personal-backup',async c=>{c.header('Cache-Control','private, no-store');return c.json(await exportTeacherBackup(c.env,currentUser(c)));});
router.post('/personal-backup/restore',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);if(Number(c.req.header('content-length')??0)>8_000_000)throw ApiError.validation('Tệp vượt 8 MB.');const text=await c.req.text();if(new TextEncoder().encode(text).byteLength>8_000_000)throw ApiError.validation('Tệp vượt 8 MB.');let raw:unknown;try{raw=JSON.parse(text);}catch{throw ApiError.validation('Tệp JSON không hợp lệ.');}return c.json(await restoreTeacherBackup(c.env,currentUser(c),parseWith(teacherBackupSchema,raw)));});
router.get('/task-retention',async c=>c.json(await retentionSettings(c.env,currentUser(c))));
router.put('/task-retention',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({days:z.union([z.literal(90),z.literal(180),z.literal(365),z.null()])}));await setRetention(c.env,currentUser(c),b.days);return c.json({ok:true});});
router.get('/note-retention',async c=>c.json(await noteRetentionSettings(c.env,currentUser(c))));
router.put('/note-retention',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({days:z.union([z.literal(90),z.literal(180),z.literal(365),z.null()])}));await setNoteRetention(c.env,currentUser(c),b.days);return c.json({ok:true});});
router.post('/note-retention/cleanup',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json({deleted:await pruneTeacherNotes(c.env,new Date(),currentUser(c).id)});});
router.post('/task-retention/cleanup',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);return c.json({deleted:await pruneTeacherTasks(c.env,new Date(),currentUser(c).id)});});
router.get('/assignments/:id/extensions',async c=>c.json(await listExtensions(c.env,currentUser(c),c.req.param('id'))));
router.put('/assignments/:id/extensions/:studentId',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({deadlineAt:z.string().datetime().nullable()}));await setExtension(c.env,currentUser(c),c.req.param('id'),c.req.param('studentId'),b.deadlineAt);return c.json({ok:true});});
router.get('/task-delegations',async c=>c.json(await listTaskDelegations(c.env,currentUser(c))));
router.put('/tasks/:id/delegation',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({schoolId:z.string().min(1).max(100),email:z.string().trim().email().max(254),expiresAt:z.string().datetime()}));await delegateTask(c.env,currentUser(c),c.req.param('id'),b.schoolId,b.email,b.expiresAt);return c.json({ok:true});});
router.delete('/tasks/:id/delegation',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await revokeTaskDelegation(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});
router.patch('/task-delegations/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({completed:z.boolean()}));await changeDelegatedTask(c.env,currentUser(c),c.req.param('id'),b.completed);return c.json({ok:true});});
router.delete('/task-delegations/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await declineTask(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});
router.get('/tasks',async c=>c.json({tasks:await listTeacherTasks(c.env,currentUser(c))}));
router.post('/tasks',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,taskSchema);return c.json({id:await createTeacherTask(c.env,currentUser(c),body)},201);});
router.patch('/tasks/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,taskSchema.partial().extend({completed:z.boolean().optional()}));await updateTeacherTask(c.env,currentUser(c),c.req.param('id'),body);return c.json({ok:true});});
router.delete('/tasks/:id',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);await deleteTeacherTask(c.env,currentUser(c),c.req.param('id'));return c.json({ok:true});});

router.post('/assignments', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, assignmentSchema);
  const result = await createAssignment(c.env, user, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'ASSIGNMENT_CREATE',
    entityType: 'assignment',
    entityId: result.assignmentId,
    metadata: { classroomId: body.classroomId, testVersionId: body.testVersionId, mode: body.mode },
    ip: clientIp(c),
  });
  return c.json(result, 201);
});

router.post('/assignments/:id/clone',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({classroomIds:z.array(z.string().min(1).max(100)).min(1).max(20)}));const copies=await cloneAssignmentToClasses(c.env,currentUser(c),c.req.param('id'),body.classroomIds);await recordAudit(c.env,{actorUserId:currentUser(c).id,action:'ASSIGNMENT_CLONE',entityType:'assignment',entityId:c.req.param('id'),metadata:{classroomIds:body.classroomIds},ip:clientIp(c)});return c.json({copies},201);});

router.get('/assignments/:id/history',async c=>c.json({history:await listAssignmentHistory(c.env,currentUser(c),c.req.param('id'))}));
router.get('/assignments/:id', async (c) => {
  const user = currentUser(c);
  return c.json(await getAssignmentDetail(c.env, user, c.req.param('id')));
});

router.put('/assignments/:id/marking-deadline',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({deadlineAt:z.string().datetime().nullable()}));await setMarkingDeadline(c.env,currentUser(c),c.req.param('id'),body.deadlineAt);return c.json({ok:true});});

router.patch('/assignments/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(c, assignmentSchema.partial().omit({ classroomId: true, testVersionId: true, studentIds: true }));
  await updateAssignment(c.env, user, c.req.param('id'), body);
  return c.json({ ok: true });
});

router.delete('/assignments/:id', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  await archiveAssignment(c.env, user, c.req.param('id'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Students & reports
// ---------------------------------------------------------------------------
router.get('/students/:userId', async (c) => {
  const user = currentUser(c);
  const studentId = c.req.param('userId');
  await requireStudentAccess(c.env, user, studentId);

  const profile = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.last_login_at, u.status, p.display_name, p.target_band
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
  )
    .bind(studentId)
    .first<{
      id: string;
      email: string;
      created_at: string;
      last_login_at: string | null;
      status: string;
      display_name: string | null;
      target_band: number | null;
    }>();
  if (!profile) throw ApiError.notFound('Student not found.');

  const teacherId=user.role==='TEACHER'?user.id:undefined;
  const scopedBindings=teacherId?[teacherId,teacherId]:[];
  const [attempts, skillPerformance, trends, taskTypes, writing, classrooms] = await Promise.all([
    listAttempts(c.env, studentId, { limit: 100 },{teacherId}),
    getSkillPerformance(c.env, {}, studentId,{teacherId}),
    getTrends(c.env, { skill: null, testType: null }, studentId,40,teacherId),
    getTaskTypePerformance(c.env, {}, studentId,{teacherId}),
    c.env.DB.prepare(
      `SELECT w.id, w.attempt_id, t.title AS test_title, w.task_label, w.word_count, w.submitted_at,
              w.response_text, w.prompt_snapshot, ws.band, ws.feedback, ws.scoring_source, ws.criteria_json
         FROM writing_submissions w
         JOIN attempts a ON a.id = w.attempt_id
         JOIN tests t ON t.id = a.test_id
         LEFT JOIN writing_scores ws ON ws.writing_submission_id = w.id
        WHERE a.user_id = ? AND TRIM(w.response_text) != '' ${teacherId?`AND ${teacherAttemptScope('a',true)}`:''}
        ORDER BY w.created_at DESC LIMIT 50`,
    )
      .bind(studentId,...scopedBindings)
      .all<{
        id: string;
        attempt_id: string;
        test_title: string;
        task_label: string;
        word_count: number;
        submitted_at: string | null;
        response_text: string;
        prompt_snapshot: string | null;
        band: number | null;
        feedback: string | null;
        scoring_source: string | null;
        criteria_json: string | null;
      }>(),
    c.env.DB.prepare(
      `SELECT c.id, c.name FROM classrooms c
        JOIN classroom_members m ON m.classroom_id = c.id AND m.user_id = ? AND m.status = 'ACTIVE'
       WHERE c.teacher_id = ? OR EXISTS (SELECT 1 FROM classroom_members ct WHERE ct.classroom_id = c.id AND ct.user_id = ? AND ct.role = 'CO_TEACHER' AND ct.status = 'ACTIVE')`,
    )
      .bind(studentId, user.id, user.id)
      .all<{ id: string; name: string }>(),
  ]);

  const integrityRows = await c.env.DB.prepare(
    `SELECT x.id AS attempt_id,
            SUM(CASE WHEN e.type IN ('TAB_HIDDEN','FULLSCREEN_EXIT') THEN 1 ELSE 0 END) AS counted,
            COUNT(e.id) AS total
       FROM attempts x LEFT JOIN integrity_events e ON e.attempt_id = x.id
      WHERE x.user_id = ? ${teacherId?`AND ${teacherAttemptScope('x')}`:''}
      GROUP BY x.id`,
  )
    .bind(studentId,...scopedBindings)
    .all<{ attempt_id: string; counted: number | null; total: number }>();
  const integrityByAttempt = new Map(integrityRows.results.map((row) => [row.attempt_id, row]));

  return c.json({
    student: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name ?? profile.email,
      createdAt: profile.created_at,
      lastLoginAt: profile.last_login_at,
      status: profile.status,
      targetBand: profile.target_band,
    },
    classrooms: classrooms.results,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      integrityCounted: integrityByAttempt.get(attempt.attemptId)?.counted ?? 0,
      integrityTotal: integrityByAttempt.get(attempt.attemptId)?.total ?? 0,
    })),
    skillPerformance,
    trends,
    taskTypes,
    writing: writing.results.map((row) => ({
      submissionId: row.id,
      attemptId: row.attempt_id,
      testTitle: row.test_title,
      taskLabel: row.task_label,
      wordCount: row.word_count,
      submittedAt: row.submitted_at,
      responseText: row.response_text,
      prompt: row.prompt_snapshot ?? '',
      scoreBand: row.band,
      feedback: row.feedback ?? '',
      scoringSource: row.scoring_source,
      criteria: (() => {
        try {
          return row.criteria_json ? (JSON.parse(row.criteria_json) as Record<string, number>) : {};
        } catch {
          return {};
        }
      })(),
    })),
  });
});

/** Full attempt view for an authorized teacher, including question-level review. */
router.get('/attempts/:attemptId', async (c) => {
  const user = currentUser(c);
  const attempt = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(c.req.param('attemptId'))
    .first<import('../services/attempt-service').AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');

  await requireTeacherAttempt(c.env,user,attempt.id);
  const view = await buildResultView(c.env, attempt, { includeReview: true, viewerIsStaff: true });
  const canMark=user.role==='ADMIN'||!!(await c.env.DB.prepare(`SELECT 1 FROM attempts a WHERE a.id=? AND ${teacherAttemptScope('a',true)}`).bind(attempt.id,user.id,user.id).first());
  return c.json({...view,canMark});
});

router.get('/classrooms/:id/analytics', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  return c.json(await getClassroomAnalytics(c.env, c.req.param('id')));
});

router.get('/classrooms/:id/students', async (c) => {
  const user = currentUser(c);
  await requireClassroomAccess(c.env, user, c.req.param('id'));
  const members = await listClassroomMembers(c.env, c.req.param('id'));
  const studentIds = members.filter((m) => m.role === 'STUDENT' && m.status === 'ACTIVE').map((m) => m.userId);
  if (studentIds.length === 0) return c.json({ students: [] });

  const stats = await c.env.DB.prepare(
    `SELECT a.user_id,
            COUNT(*) AS attempts,
            SUM(CASE WHEN a.status IN ('SUBMITTED','EXPIRED') THEN 1 ELSE 0 END) AS submitted,
            AVG(CASE WHEN a.status IN ('SUBMITTED','EXPIRED') THEN a.raw_score END) AS avg_raw,
            AVG(a.estimated_band) AS avg_band,
            MAX(a.estimated_band) AS best_band
       FROM attempts a
      WHERE a.user_id IN (${studentIds.map(() => '?').join(',')})
        AND a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)
      GROUP BY a.user_id`,
  )
    .bind(...studentIds, c.req.param('id'))
    .all<{
      user_id: string;
      attempts: number;
      submitted: number;
      avg_raw: number | null;
      avg_band: number | null;
      best_band: number | null;
    }>();

  const statsByUser = new Map(stats.results.map((row) => [row.user_id, row]));

  return c.json({
    students: members
      .filter((member) => member.role === 'STUDENT')
      .map((member) => ({
        ...member,
        attempts: statsByUser.get(member.userId)?.attempts ?? 0,
        submitted: statsByUser.get(member.userId)?.submitted ?? 0,
        averageRawScore:
          statsByUser.get(member.userId)?.avg_raw !== undefined && statsByUser.get(member.userId)!.avg_raw !== null
            ? Math.round(statsByUser.get(member.userId)!.avg_raw! * 10) / 10
            : null,
        averageBand:
          statsByUser.get(member.userId)?.avg_band != null
            ? Math.round(statsByUser.get(member.userId)!.avg_band! * 2) / 2
            : null,
        bestBand: statsByUser.get(member.userId)?.best_band ?? null,
      })),
  });
});


router.get('/writing-submissions/:submissionId/review/:versionId/discussion',async c=>c.json(await writingFeedbackDiscussion(c.env,currentUser(c),c.req.param('submissionId'),c.req.param('versionId'),'teacher')));
router.post('/writing-submissions/:submissionId/review/:versionId/messages',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const b=await parseBody(c,z.object({index:z.number().int().min(0).max(99),body:z.string().trim().min(1).max(2000)}));await addWritingFeedbackMessage(c.env,currentUser(c),c.req.param('submissionId'),c.req.param('versionId'),b.index,'teacher',b.body);return c.json({ok:true});});
router.get('/writing-submissions/:submissionId/review',async c=>c.json(await teacherWritingReview(c.env,currentUser(c),c.req.param('submissionId'))));
router.put('/writing-submissions/:submissionId/review',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({version:z.number().int().min(1).max(10),comments:z.array(z.object({start:z.number().int().min(0),end:z.number().int().min(0),text:z.string().trim().min(1).max(2000)})).max(100),publish:z.boolean()}));await saveWritingReview(c.env,currentUser(c),c.req.param('submissionId'),body.version,body.comments,body.publish);return c.json({ok:true});});

router.get('/writing-queue', async (c) => {
  const user = currentUser(c);
  const unmarkedOnly = c.req.query('unmarked') === '1' || c.req.query('unmarked') === 'true';
  const classroomId=c.req.query('classroom')?.slice(0,100)||undefined;const deadline=c.req.query('deadline');const order=c.req.query('order');
  return c.json(await listWritingQueue(c.env, user, { unmarkedOnly, classroomId, deadline:deadline==='has'||deadline==='none'?deadline:undefined, order:order==='deadline'?'deadline':undefined }));
});

router.put('/attempts/:attemptId/question-feedback',async c=>{assertCsrf(c,c.get('session')?.csrfToken??null);const body=await parseBody(c,z.object({questionId:z.string().min(1).max(100),body:z.string().max(2000)}));await setQuestionFeedback(c.env,currentUser(c),c.req.param('attemptId'),body.questionId,body.body);return c.json({ok:true});});

router.post('/attempts/:attemptId/question-marks', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const attemptId = c.req.param('attemptId');
  const attempt = await c.env.DB.prepare('SELECT id, user_id FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<{ id: string; user_id: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  await requireTeacherAttempt(c.env,user,attempt.id,true);

  const body = await parseBody(
    c,
    z.object({
      questionId: z.string().min(1).max(64),
      isCorrect: z.boolean().nullable(),
      points: z.number().min(0).max(20).nullable().optional(),
    }),
  );
  const totals = await markQuestionManually(c.env, attemptId, body);
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'QUESTION_MARK_SET',
    entityType: 'attempt',
    entityId: attemptId,
    metadata: { questionId: body.questionId, isCorrect: body.isCorrect },
    ip: clientIp(c),
  });
  return c.json({ ok: true, ...totals });
});

/**
 * AI first-pass marking for one Writing submission. The result is stored as
 * `scoring_source = 'AI'` and a teacher can still override it with a normal
 * writing-scores call; the AI feedback stays in the audit table either way.
 */
/** The judges' latest estimate for one essay, used to prefill the quick-mark form. */
router.get('/writing-submissions/:submissionId/ai-draft', async (c) => {
  const user = currentUser(c);
  const submissionId = c.req.param('submissionId');
  const submission = await c.env.DB.prepare(
    `SELECT w.id, a.user_id, a.id AS attempt_id FROM writing_submissions w JOIN attempts a ON a.id = w.attempt_id WHERE w.id = ?`,
  )
    .bind(submissionId)
    .first<{ id: string; user_id: string; attempt_id:string }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');
  await requireTeacherAttempt(c.env,user,submission.attempt_id,true);
  const marks = await loadWritingMarks(c.env, [submissionId]);
  return c.json({ mark: marks.get(submissionId) ?? null });
});

router.post('/writing-submissions/:submissionId/ai-score', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const submission = await c.env.DB.prepare(
    `SELECT w.id, a.user_id, a.id AS attempt_id FROM writing_submissions w JOIN attempts a ON a.id = w.attempt_id WHERE w.id = ?`,
  )
    .bind(c.req.param('submissionId'))
    .first<{ id: string; user_id: string; attempt_id:string }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');
  await requireTeacherAttempt(c.env,user,submission.attempt_id,true);

  const body = await parseBody(c, z.object({ force: z.boolean().optional() }).optional());
  let grade: Awaited<ReturnType<typeof scoreWritingSubmissionWithAi>>;
  try {
    grade = await scoreWritingSubmissionWithAi(c.env, submission.id, {
      actorUserId: user.id,
      force: body?.force ?? true,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('AI_UNAVAILABLE', describeAiFailure(error, { submissionId: submission.id, userId: user.id }).message);
  }

  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'WRITING_AI_SCORE',
    entityType: 'writing_submission',
    entityId: submission.id,
    metadata: {
      band: grade.band,
      judges: grade.judges.map((judge) => ({ judge: judge.judge, band: judge.band })),
      spread: grade.spread,
    },
    ip: clientIp(c),
  });
  return c.json({ ok: true, score: grade });
});

router.post('/writing-scores', async (c) => {
  const user = currentUser(c);
  assertCsrf(c, c.get('session')?.csrfToken ?? null);
  const body = await parseBody(
    c,
    z.object({
      writingSubmissionId: z.string().min(1).max(64),
      band: z.number().min(0).max(9).nullable(),
      feedback: z.string().max(8000).optional(),
      criteria: z.record(z.string(), z.number().min(0).max(9)).optional(),
    }),
  );

  const submission = await c.env.DB.prepare(
    `SELECT w.id, a.user_id, a.id AS attempt_id FROM writing_submissions w JOIN attempts a ON a.id = w.attempt_id WHERE w.id = ?`,
  )
    .bind(body.writingSubmissionId)
    .first<{ id: string; user_id: string; attempt_id:string }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');
  await requireTeacherAttempt(c.env,user,submission.attempt_id,true);

  const result = await setWritingScore(c.env, {
    writingSubmissionId: body.writingSubmissionId,
    band: body.band,
    feedback: body.feedback,
    criteria: body.criteria,
    source: 'TEACHER',
    scoredBy: user.id,
  });
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: 'WRITING_SCORE_SET',
    entityType: 'writing_submission',
    entityId: body.writingSubmissionId,
    metadata: { band: body.band, attemptId: result.attemptId },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

export default router;
