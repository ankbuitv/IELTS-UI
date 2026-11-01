import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';

export type LessonPlanInput = { title: string; subject: string; week: number | null; content: string };

async function requireActiveStaff(env: Env, user: AuthUser, schoolId: string) {
  if (!['ADMIN', 'TEACHER', 'MENTOR'].includes(user.role)) throw ApiError.forbidden();
  const member = await env.DB.prepare(`SELECT 1 AS ok FROM school_members m JOIN schools s ON s.id=m.school_id
    WHERE m.school_id=? AND m.user_id=? AND m.status='ACTIVE' AND m.role IN ('OWNER','TEACHER') AND s.status='APPROVED'`)
    .bind(schoolId, user.id).first();
  if (!member) throw ApiError.forbidden('Chỉ nhân sự đang hoạt động của trường đã duyệt được sử dụng giáo án.');
}

/** Lesson plans are personal drafts; even a school owner cannot read another author's drafts. */
export async function listLessonPlans(env: Env, user: AuthUser, schoolId: string) {
  await requireActiveStaff(env, user, schoolId);
  return (await env.DB.prepare(`SELECT id,title,subject,week,content,created_at,updated_at FROM school_lesson_plans
    WHERE school_id=? AND author_id=? ORDER BY updated_at DESC LIMIT 200`).bind(schoolId, user.id).all()).results;
}

export async function createLessonPlan(env: Env, user: AuthUser, schoolId: string, input: LessonPlanInput) {
  await requireActiveStaff(env, user, schoolId);
  const id = newId('lp'); const now = nowIso();
  await env.DB.prepare(`INSERT INTO school_lesson_plans (id,school_id,author_id,title,subject,week,content,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(id, schoolId, user.id, input.title, input.subject, input.week, input.content, now, now).run();
  return { id };
}

export async function updateLessonPlan(env: Env, user: AuthUser, schoolId: string, id: string, input: LessonPlanInput) {
  await requireActiveStaff(env, user, schoolId);
  const result = await env.DB.prepare(`UPDATE school_lesson_plans SET title=?,subject=?,week=?,content=?,updated_at=?
    WHERE id=? AND school_id=? AND author_id=?`).bind(input.title, input.subject, input.week, input.content, nowIso(), id, schoolId, user.id).run();
  if (!result.meta.changes) throw ApiError.notFound('Không tìm thấy giáo án của bạn.');
}

export async function deleteLessonPlan(env: Env, user: AuthUser, schoolId: string, id: string) {
  await requireActiveStaff(env, user, schoolId);
  const result = await env.DB.prepare('DELETE FROM school_lesson_plans WHERE id=? AND school_id=? AND author_id=?').bind(id, schoolId, user.id).run();
  if (!result.meta.changes) throw ApiError.notFound('Không tìm thấy giáo án của bạn.');
}
