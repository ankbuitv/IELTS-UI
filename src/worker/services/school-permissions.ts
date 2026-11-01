import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { requireSchoolOwner } from './school-service';

export type SchoolPermission = 'MANAGE_GROUPS' | 'MANAGE_CALENDAR' | 'REVIEW_ALL';
const all:SchoolPermission[] = ['MANAGE_GROUPS','MANAGE_CALENDAR','REVIEW_ALL'];
export async function schoolPermissions(env:Env,user:AuthUser,schoolId:string):Promise<SchoolPermission[]> {
  if (!['ADMIN','TEACHER','MENTOR'].includes(user.role)) throw ApiError.forbidden();
  const member=await env.DB.prepare(`SELECT s.owner_user_id FROM schools s JOIN school_members m ON m.school_id=s.id
    WHERE s.id=? AND s.status='APPROVED' AND m.user_id=? AND m.status='ACTIVE'`).bind(schoolId,user.id).first<{owner_user_id:string}>();
  if (!member) throw ApiError.forbidden('Chỉ nhân sự đang hoạt động trong trường đã duyệt được truy cập.');
  if (member.owner_user_id===user.id) return [...all];
  const result=await env.DB.prepare('SELECT permission FROM school_staff_permissions WHERE school_id=? AND user_id=?').bind(schoolId,user.id).all<{permission:SchoolPermission}>();
  return result.results.map(r=>r.permission).filter(permission=>all.includes(permission));
}
export async function requireSchoolPermission(env:Env,user:AuthUser,schoolId:string,permission:SchoolPermission) {
  if (!(await schoolPermissions(env,user,schoolId)).includes(permission)) throw ApiError.forbidden('Bạn không được cấp quyền quản lý chức năng này.');
}
export async function listSchoolPermissions(env:Env,user:AuthUser,schoolId:string) {
  await requireSchoolOwner(env,user,schoolId);
  return (await env.DB.prepare(`SELECT sp.user_id,sp.permission FROM school_staff_permissions sp
    JOIN school_members sm ON sm.school_id=sp.school_id AND sm.user_id=sp.user_id AND sm.status='ACTIVE'
    WHERE sp.school_id=? ORDER BY sp.user_id,sp.permission`).bind(schoolId).all()).results;
}
export async function setSchoolPermissions(env:Env,user:AuthUser,schoolId:string,targetId:string,permissions:SchoolPermission[]) {
  const school=await requireSchoolOwner(env,user,schoolId);
  if (school.owner_user_id===targetId) throw ApiError.validation('Quản lý trường đã có đầy đủ quyền.');
  const member=await env.DB.prepare(`SELECT 1 AS ok FROM school_members m JOIN users u ON u.id=m.user_id
    WHERE m.school_id=? AND m.user_id=? AND m.status='ACTIVE' AND m.role='TEACHER' AND u.status='ACTIVE' AND u.role IN ('TEACHER','MENTOR')`).bind(schoolId,targetId).first();
  if(!member) throw ApiError.validation('Chỉ có thể phân quyền cho nhân sự đang hoạt động trong trường.');
  const unique=[...new Set(permissions)];const now=nowIso();
  await env.DB.batch([env.DB.prepare('DELETE FROM school_staff_permissions WHERE school_id=? AND user_id=?').bind(schoolId,targetId),...unique.map(permission=>env.DB.prepare('INSERT INTO school_staff_permissions(school_id,user_id,permission,granted_by,granted_at) VALUES(?,?,?,?,?)').bind(schoolId,targetId,permission,user.id,now))]);
  await recordAudit(env,{actorUserId:user.id,action:'SCHOOL_PERMISSIONS_SET',entityType:'school',entityId:schoolId,metadata:{userId:targetId,permissions:unique}});
}
