import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { requireSchoolPermission } from './school-permissions';

type GroupInput = { name: string; leaderId: string | null; memberIds: string[] };
type EventInput = { title: string; description: string; startsAt: string; endsAt: string; kind?: 'EVENT'|'HOLIDAY'|'LEAVE' };

export async function requireActiveSchoolStaff(env: Env, user: AuthUser, schoolId: string) {
  if (!['ADMIN', 'TEACHER', 'MENTOR'].includes(user.role)) throw ApiError.forbidden();
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM school_members m JOIN schools s ON s.id=m.school_id
    WHERE m.school_id=? AND m.user_id=? AND m.status='ACTIVE' AND m.role IN ('OWNER','TEACHER') AND s.status='APPROVED'`).bind(schoolId,user.id).first();
  if (!row) throw ApiError.forbidden('Chỉ nhân sự đang hoạt động của trường đã duyệt được truy cập.');
}

async function validateGroup(env: Env, schoolId: string, input: GroupInput) {
  const ids = [...new Set(input.memberIds)];
  if (input.leaderId && !ids.includes(input.leaderId)) throw ApiError.validation('Tổ trưởng phải nằm trong danh sách thành viên.');
  if (ids.length) {
    const list = await env.DB.prepare(`SELECT m.user_id FROM school_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' WHERE m.school_id=? AND m.status='ACTIVE' AND m.role IN ('OWNER','TEACHER') AND m.user_id IN (${ids.map(() => '?').join(',')})`).bind(schoolId,...ids).all<{user_id:string}>();
    if (list.results.length !== ids.length) throw ApiError.validation('Thành viên phải đang hoạt động trong trường.');
  }
  return ids;
}

export async function listSubjectGroups(env: Env, user: AuthUser, schoolId: string) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_GROUPS');
  const groups = (await env.DB.prepare(`SELECT id,name,leader_id,created_at,updated_at FROM school_subject_groups WHERE school_id=? ORDER BY name LIMIT 200`).bind(schoolId).all()).results;
  const members = (await env.DB.prepare(`SELECT gm.group_id,gm.user_id FROM school_subject_group_members gm
    JOIN school_subject_groups g ON g.id=gm.group_id JOIN school_members sm ON sm.school_id=g.school_id AND sm.user_id=gm.user_id AND sm.status='ACTIVE'
    JOIN users u ON u.id=gm.user_id AND u.status='ACTIVE'
    WHERE g.school_id=?`).bind(schoolId).all<{group_id:string;user_id:string}>()).results;
  return groups.map(group => ({...group, memberIds: members.filter(m => m.group_id === group.id).map(m => m.user_id)}));
}
export async function saveSubjectGroup(env: Env, user: AuthUser, schoolId: string, id: string | null, input: GroupInput) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_GROUPS');
  const ids=await validateGroup(env,schoolId,input); const now=nowIso(); const groupId=id ?? newId('sg');
  const existing = id ? await env.DB.prepare('SELECT leader_id FROM school_subject_groups WHERE id=? AND school_id=?').bind(id,schoolId).first<{leader_id:string|null}>() : null;
  if (id && !existing) throw ApiError.notFound('Không tìm thấy tổ bộ môn.');
  // Group managers can assign leaders, but cannot use that permission to appoint themselves as reviewer.
  if (input.leaderId === user.id && existing?.leader_id !== user.id) {
    const owner=await env.DB.prepare('SELECT owner_user_id FROM schools WHERE id=?').bind(schoolId).first<{owner_user_id:string}>();
    if (owner?.owner_user_id !== user.id) throw ApiError.forbidden('Chỉ đại diện trường có thể phân công bạn làm tổ trưởng.');
  }
  const duplicate=await env.DB.prepare('SELECT id FROM school_subject_groups WHERE school_id=? AND lower(name)=lower(?) AND id<>?').bind(schoolId,input.name,groupId).first();
  if (duplicate) throw ApiError.conflict('Tên tổ bộ môn đã tồn tại.');
  const write=id ? env.DB.prepare('UPDATE school_subject_groups SET name=?,leader_id=?,updated_at=? WHERE id=? AND school_id=?').bind(input.name,input.leaderId,now,groupId,schoolId) : env.DB.prepare('INSERT INTO school_subject_groups(id,school_id,name,leader_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(groupId,schoolId,input.name,input.leaderId,now,now);
  await env.DB.batch([write,env.DB.prepare('DELETE FROM school_subject_group_members WHERE group_id=?').bind(groupId),...ids.map(uid=>env.DB.prepare('INSERT INTO school_subject_group_members(group_id,user_id) VALUES(?,?)').bind(groupId,uid))]);
  return {id:groupId};
}
export async function deleteSubjectGroup(env: Env, user: AuthUser, schoolId: string, id: string) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_GROUPS');
  const exists=await env.DB.prepare('SELECT 1 AS ok FROM school_subject_groups WHERE id=? AND school_id=?').bind(id,schoolId).first();
  if (!exists) throw ApiError.notFound('Không tìm thấy tổ bộ môn.');
  if (await env.DB.prepare('SELECT 1 AS ok FROM school_lesson_submissions WHERE group_id=? LIMIT 1').bind(id).first()) throw ApiError.conflict('Tổ đã có giáo án gửi duyệt; không thể xóa để bảo toàn lịch sử.');
  await env.DB.batch([env.DB.prepare('DELETE FROM school_subject_group_members WHERE group_id=?').bind(id), env.DB.prepare('DELETE FROM school_subject_groups WHERE id=? AND school_id=?').bind(id,schoolId)]);
}
export async function listSchoolEvents(env: Env,user:AuthUser,schoolId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  return (await env.DB.prepare('SELECT id,title,description,starts_at,ends_at,created_by,kind FROM school_events WHERE school_id=? ORDER BY starts_at DESC LIMIT 200').bind(schoolId).all()).results;
}
export async function saveSchoolEvent(env:Env,user:AuthUser,schoolId:string,id:string|null,input:EventInput) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_CALENDAR');
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw ApiError.validation('Thời gian kết thúc phải sau thời gian bắt đầu.');
  const now=nowIso(); const eventId=id ?? newId('se');
  if (id) {
    const result=await env.DB.prepare('UPDATE school_events SET title=?,description=?,starts_at=?,ends_at=?,kind=?,updated_at=? WHERE id=? AND school_id=?').bind(input.title,input.description,input.startsAt,input.endsAt,input.kind ?? 'EVENT',now,id,schoolId).run();
    if (!result.meta.changes) throw ApiError.notFound('Không tìm thấy sự kiện.');
  } else await env.DB.prepare('INSERT INTO school_events(id,school_id,title,description,starts_at,ends_at,kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(eventId,schoolId,input.title,input.description,input.startsAt,input.endsAt,input.kind ?? 'EVENT',user.id,now,now).run();
  return {id:eventId};
}
export async function deleteSchoolEvent(env:Env,user:AuthUser,schoolId:string,id:string) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_CALENDAR');
  const result=await env.DB.prepare('DELETE FROM school_events WHERE id=? AND school_id=?').bind(id,schoolId).run();
  if (!result.meta.changes) throw ApiError.notFound('Không tìm thấy sự kiện.');
}

export async function groupStaffDirectory(env:Env,user:AuthUser,schoolId:string) {
  await requireSchoolPermission(env,user,schoolId,'MANAGE_GROUPS');
  return (await env.DB.prepare(`SELECT m.user_id,m.role,m.status,u.email,p.display_name FROM school_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN user_profiles p ON p.user_id=u.id WHERE m.school_id=? AND m.status='ACTIVE' AND u.status='ACTIVE' ORDER BY u.email LIMIT 200`).bind(schoolId).all()).results;
}
