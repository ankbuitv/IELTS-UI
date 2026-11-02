import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { requireActiveSchoolStaff } from './school-operations-service';
import { schoolPermissions } from './school-permissions';

export type LessonPlanInput = { title: string; subject: string; week: number | null; content: string };

/** Lesson plans are personal drafts; even a school owner cannot read another author's drafts. */
export async function listLessonPlans(env: Env, user: AuthUser, schoolId: string) {
  await requireActiveSchoolStaff(env, user, schoolId);
  return (await env.DB.prepare(`SELECT id,title,subject,week,content,created_at,updated_at FROM school_lesson_plans
    WHERE school_id=? AND author_id=? ORDER BY updated_at DESC LIMIT 200`).bind(schoolId, user.id).all()).results;
}

export async function createLessonPlan(env: Env, user: AuthUser, schoolId: string, input: LessonPlanInput) {
  await requireActiveSchoolStaff(env, user, schoolId);
  const id = newId('lp'); const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO school_lesson_plans (id,school_id,author_id,title,subject,week,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, schoolId, user.id, input.title, input.subject, input.week, input.content, now, now),
    env.DB.prepare(`INSERT INTO school_lesson_plan_versions(id,plan_id,school_id,author_id,title,subject,week,content,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(newId('lpv'),id,schoolId,user.id,input.title,input.subject,input.week,input.content,now),
  ]);
  return { id };
}

export async function updateLessonPlan(env: Env, user: AuthUser, schoolId: string, id: string, input: LessonPlanInput) {
  await requireActiveSchoolStaff(env, user, schoolId);
  const now = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE school_lesson_plans SET title=?,subject=?,week=?,content=?,updated_at=? WHERE id=? AND school_id=? AND author_id=?`).bind(input.title, input.subject, input.week, input.content, now, id, schoolId, user.id),
    env.DB.prepare(`INSERT INTO school_lesson_plan_versions(id,plan_id,school_id,author_id,title,subject,week,content,created_at)
      SELECT ?,id,school_id,author_id,title,subject,week,content,? FROM school_lesson_plans WHERE id=? AND school_id=? AND author_id=?`).bind(newId('lpv'),now,id,schoolId,user.id),
  ]);
  if (!results[0]?.meta.changes) throw ApiError.notFound('Không tìm thấy giáo án của bạn.');
}

export async function deleteLessonPlan(env: Env, user: AuthUser, schoolId: string, id: string) {
  await requireActiveSchoolStaff(env, user, schoolId);
  if (await env.DB.prepare('SELECT 1 AS ok FROM school_lesson_submissions WHERE plan_id=? AND school_id=? AND author_id=? LIMIT 1').bind(id,schoolId,user.id).first()) throw ApiError.conflict('Giáo án đã gửi duyệt được lưu để bảo toàn lịch sử, không thể xóa.');
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM school_lesson_plan_versions WHERE plan_id=? AND school_id=? AND author_id=?').bind(id,schoolId,user.id),
    env.DB.prepare('DELETE FROM school_lesson_attachments WHERE plan_id=? AND school_id=? AND author_id=?').bind(id,schoolId,user.id),
    env.DB.prepare('DELETE FROM school_lesson_plans WHERE id=? AND school_id=? AND author_id=?').bind(id,schoolId,user.id),
  ]);
  const result = results[2]!;
  if (!result.meta.changes) throw ApiError.notFound('Không tìm thấy giáo án của bạn.');
}

export async function listPlanVersions(env: Env,user:AuthUser,schoolId:string,planId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  const exists=await env.DB.prepare('SELECT 1 AS ok FROM school_lesson_plans WHERE id=? AND school_id=? AND author_id=?').bind(planId,schoolId,user.id).first();
  if (!exists) throw ApiError.notFound();
  return (await env.DB.prepare('SELECT id,title,subject,week,content,created_at FROM school_lesson_plan_versions WHERE plan_id=? AND author_id=? ORDER BY created_at DESC LIMIT 100').bind(planId,user.id).all()).results;
}
export async function mySubjectGroups(env:Env,user:AuthUser,schoolId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  return (await env.DB.prepare(`SELECT g.id,g.name,g.leader_id FROM school_subject_groups g JOIN school_subject_group_members gm ON gm.group_id=g.id
    JOIN school_members sm ON sm.school_id=g.school_id AND sm.user_id=g.leader_id AND sm.status='ACTIVE'
    WHERE g.school_id=? AND gm.user_id=? ORDER BY g.name`).bind(schoolId,user.id).all()).results;
}
export async function reviewAccess(env:Env,user:AuthUser,schoolId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  if ((await schoolPermissions(env,user,schoolId)).includes('REVIEW_ALL')) return true;
  const row=await env.DB.prepare(`SELECT 1 AS ok FROM schools s WHERE s.id=? AND s.owner_user_id=?
    UNION ALL SELECT 1 FROM school_subject_groups WHERE school_id=? AND leader_id=? LIMIT 1`).bind(schoolId,user.id,schoolId,user.id).first();
  return !!row;
}
export async function submitLessonPlan(env:Env,user:AuthUser,schoolId:string,planId:string,groupId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  const submissionId=newId('lps');
  const results=await env.DB.batch([env.DB.prepare(`INSERT INTO school_lesson_submissions(id,school_id,plan_id,group_id,author_id,title,subject,week,content,status,created_at)
    SELECT ?,p.school_id,p.id,g.id,p.author_id,p.title,p.subject,p.week,p.content,'PENDING',? FROM school_lesson_plans p
    JOIN school_subject_groups g ON g.id=? AND g.school_id=p.school_id
    JOIN school_subject_group_members gm ON gm.group_id=g.id AND gm.user_id=p.author_id
    JOIN school_members leader ON leader.school_id=g.school_id AND leader.user_id=g.leader_id AND leader.status='ACTIVE'
    WHERE p.id=? AND p.school_id=? AND p.author_id=? AND NOT EXISTS(SELECT 1 FROM school_lesson_submissions old WHERE old.plan_id=p.id AND old.status='PENDING')`)
    .bind(submissionId,nowIso(),groupId,planId,schoolId,user.id),
    env.DB.prepare(`INSERT INTO school_lesson_submission_attachments(submission_id,attachment_id)
      SELECT ?,a.id FROM school_lesson_attachments a JOIN school_lesson_submissions s ON s.id=? AND s.plan_id=a.plan_id WHERE a.plan_id=? AND a.school_id=? AND a.author_id=? AND a.active=1`).bind(submissionId,submissionId,planId,schoolId,user.id)]);
  if (!results[0]?.meta.changes) throw ApiError.conflict('Không thể gửi: kiểm tra tổ, tổ trưởng, quyền thành viên và giáo án đang chờ duyệt.');
}
export async function mySubmissions(env:Env,user:AuthUser,schoolId:string,planId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  return (await env.DB.prepare(`SELECT sub.id,sub.group_id,g.name AS group_name,sub.status,sub.comment,sub.created_at,sub.reviewed_at
    FROM school_lesson_submissions sub JOIN school_subject_groups g ON g.id=sub.group_id
    WHERE sub.school_id=? AND sub.plan_id=? AND sub.author_id=? ORDER BY sub.created_at DESC LIMIT 100`).bind(schoolId,planId,user.id).all()).results;
}
export async function reviewSubmissions(env:Env,user:AuthUser,schoolId:string) {
  if (!await reviewAccess(env,user,schoolId)) throw ApiError.forbidden('Chỉ quản lý trường hoặc tổ trưởng có quyền duyệt.');
  return (await env.DB.prepare(`SELECT sub.id,sub.author_id,sub.title,sub.subject,sub.week,sub.content,sub.status,sub.comment,sub.created_at,sub.reviewed_at,g.name AS group_name,u.email AS author_email,p.display_name AS author_name
    FROM school_lesson_submissions sub JOIN school_subject_groups g ON g.id=sub.group_id JOIN schools s ON s.id=sub.school_id
    JOIN users u ON u.id=sub.author_id LEFT JOIN user_profiles p ON p.user_id=u.id
    WHERE sub.school_id=? AND (s.owner_user_id=? OR g.leader_id=? OR EXISTS(SELECT 1 FROM (SELECT school_id,user_id,permission FROM school_staff_permissions UNION ALL SELECT school_id,user_id,permission FROM school_temporary_permissions WHERE expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) sp WHERE sp.school_id=sub.school_id AND sp.user_id=? AND sp.permission='REVIEW_ALL')) ORDER BY CASE WHEN sub.status='PENDING' AND sub.author_id<>? THEN 0 ELSE 1 END, CASE WHEN sub.status='PENDING' AND sub.author_id<>? THEN sub.created_at END ASC, sub.created_at DESC, sub.id ASC LIMIT 200`).bind(schoolId,user.id,user.id,user.id,user.id,user.id).all()).results;
}
export async function reviewLessonSubmission(env:Env,user:AuthUser,schoolId:string,id:string,status:'APPROVED'|'RETURNED',comment:string) {
  if (!await reviewAccess(env,user,schoolId)) throw ApiError.forbidden('Chỉ quản lý trường hoặc tổ trưởng có quyền duyệt.');
  if (status === 'RETURNED' && !comment.trim()) throw ApiError.validation('Vui lòng nhập nhận xét khi trả lại.');
  const result=await env.DB.prepare(`UPDATE school_lesson_submissions SET status=?,reviewer_id=?,comment=?,reviewed_at=?
    WHERE id=? AND school_id=? AND status='PENDING' AND author_id<>? AND (EXISTS(SELECT 1 FROM schools s WHERE s.id=school_lesson_submissions.school_id AND s.owner_user_id=?) OR EXISTS(SELECT 1 FROM school_subject_groups g WHERE g.id=school_lesson_submissions.group_id AND g.school_id=school_lesson_submissions.school_id AND g.leader_id=?) OR EXISTS(SELECT 1 FROM (SELECT school_id,user_id,permission FROM school_staff_permissions UNION ALL SELECT school_id,user_id,permission FROM school_temporary_permissions WHERE expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) sp WHERE sp.school_id=school_lesson_submissions.school_id AND sp.user_id=? AND sp.permission='REVIEW_ALL'))`)
    .bind(status,user.id,comment,nowIso(),id,schoolId,user.id,user.id,user.id,user.id).run();
  if (!result.meta.changes) throw ApiError.conflict('Không thể duyệt: giáo án không còn chờ duyệt, không thuộc quyền của bạn hoặc là giáo án của chính bạn.');
}

/** Oldest actionable submissions first, scoped to the signed-in reviewer. */
export async function pendingLessonReviews(env:Env,user:AuthUser,schoolId:string){
  if(!await reviewAccess(env,user,schoolId))throw ApiError.forbidden('Chỉ nhân sự được phân công duyệt mới được xem hộp việc.');
  const where=`sub.school_id=? AND sub.status='PENDING' AND sub.author_id<>? AND (s.owner_user_id=? OR g.leader_id=? OR EXISTS(SELECT 1 FROM (SELECT school_id,user_id,permission FROM school_staff_permissions UNION ALL SELECT school_id,user_id,permission FROM school_temporary_permissions WHERE expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) sp WHERE sp.school_id=sub.school_id AND sp.user_id=? AND sp.permission='REVIEW_ALL'))`;
  const params=[schoolId,user.id,user.id,user.id,user.id];
  const total=await env.DB.prepare(`SELECT COUNT(*) AS count FROM school_lesson_submissions sub JOIN school_subject_groups g ON g.id=sub.group_id JOIN schools s ON s.id=sub.school_id WHERE ${where}`).bind(...params).first<{count:number}>();
  const rows=await env.DB.prepare(`SELECT sub.id,sub.title,sub.subject,sub.created_at,g.name AS group_name,COALESCE(NULLIF(TRIM(p.display_name),''),u.email) AS author_name FROM school_lesson_submissions sub JOIN school_subject_groups g ON g.id=sub.group_id JOIN schools s ON s.id=sub.school_id JOIN users u ON u.id=sub.author_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE ${where} ORDER BY sub.created_at ASC,sub.id ASC LIMIT 100`).bind(...params).all();
  return {total:total?.count??0,items:rows.results};
}
