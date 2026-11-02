import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { requireSchoolOwner } from './school-service';

export type SchoolPermission = 'MANAGE_GROUPS' | 'MANAGE_CALENDAR' | 'REVIEW_ALL';
const all:SchoolPermission[] = ['MANAGE_GROUPS','MANAGE_CALENDAR','REVIEW_ALL'];
export async function schoolPermissions(env:Env,user:AuthUser,schoolId:string):Promise<SchoolPermission[]> {
  if (!['ADMIN','TEACHER','MENTOR'].includes(user.role)) throw ApiError.forbidden();
  const member=await env.DB.prepare(`SELECT s.owner_user_id FROM schools s JOIN school_members m ON m.school_id=s.id
    WHERE s.id=? AND s.status='APPROVED' AND m.user_id=? AND m.status='ACTIVE'`).bind(schoolId,user.id).first<{owner_user_id:string}>();
  if (!member) throw ApiError.forbidden('Chỉ nhân sự đang hoạt động trong trường đã duyệt được truy cập.');
  if (member.owner_user_id===user.id) return [...all];
  const result=await env.DB.prepare(`SELECT permission FROM school_staff_permissions WHERE school_id=? AND user_id=? UNION SELECT permission FROM school_temporary_permissions WHERE school_id=? AND user_id=? AND expires_at>?`).bind(schoolId,user.id,schoolId,user.id,nowIso()).all<{permission:SchoolPermission}>();
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
  const guard=`EXISTS (SELECT 1 FROM schools s JOIN school_members m ON m.school_id=s.id JOIN users u ON u.id=m.user_id WHERE s.id=? AND s.status='APPROVED' AND s.owner_user_id=? AND m.user_id=? AND m.status='ACTIVE' AND m.role='TEACHER' AND u.status='ACTIVE' AND u.role IN ('TEACHER','MENTOR'))`;
  // Snapshot and mutation commit together. If auditing fails, no permissions change.
  const audit=env.DB.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at)
    SELECT ?,?,'SCHOOL_PERMISSIONS_SET','school',?,json_object('userId',?,'before',json(COALESCE((SELECT json_group_array(permission) FROM school_staff_permissions WHERE school_id=? AND user_id=?),'[]')),'permissions',json(?)),? WHERE ${guard}`)
    .bind(newId('aud'),user.id,schoolId,targetId,schoolId,targetId,JSON.stringify(unique),now,schoolId,user.id,targetId);
  const remove=env.DB.prepare(`DELETE FROM school_staff_permissions WHERE school_id=? AND user_id=? AND ${guard}`).bind(schoolId,targetId,schoolId,user.id,targetId);
  const inserts=unique.map(permission=>env.DB.prepare(`INSERT INTO school_staff_permissions(school_id,user_id,permission,granted_by,granted_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(schoolId,targetId,permission,user.id,now,schoolId,user.id,targetId));
  const results=await env.DB.batch([audit,remove,...inserts]);
  if(!results[0]?.meta.changes)throw ApiError.conflict('Quyền đại diện hoặc trạng thái thành viên đã thay đổi.');
}

/** School owner's bounded permission audit only; never returns private learner work. */
export async function schoolPermissionHistory(env:Env,user:AuthUser,schoolId:string){
  await requireSchoolOwner(env,user,schoolId);
  const rows=await env.DB.prepare(`SELECT a.id,a.created_at,a.actor_user_id,a.metadata_json,actor.email AS actor_email
    FROM admin_audit_logs a LEFT JOIN users actor ON actor.id=a.actor_user_id
    WHERE a.entity_type='school' AND a.entity_id=? AND a.action='SCHOOL_PERMISSIONS_SET'
    ORDER BY a.created_at DESC,a.id DESC LIMIT 100`).bind(schoolId).all<{id:string;created_at:string;actor_user_id:string|null;metadata_json:string;actor_email:string|null}>();
  return rows.results.map(row=>{let value:{userId?:unknown;before?:unknown;permissions?:unknown}={};try{value=JSON.parse(row.metadata_json);}catch{/* Skip invalid metadata safely. */}return {id:row.id,createdAt:row.created_at,actorId:row.actor_user_id,actorEmail:row.actor_email,targetId:typeof value.userId==='string'?value.userId:null,before:Array.isArray(value.before)?value.before.filter((p):p is SchoolPermission=>typeof p==='string'&&all.includes(p as SchoolPermission)):null,after:Array.isArray(value.permissions)?value.permissions.filter((p):p is SchoolPermission=>typeof p==='string'&&all.includes(p as SchoolPermission)):[]};});
}

/** Separate temporary grant never extends or removes a permanent grant. */
export async function temporaryPermissions(env:Env,user:AuthUser,schoolId:string){await requireSchoolOwner(env,user,schoolId);return(await env.DB.prepare(`SELECT t.user_id,t.permission,t.expires_at FROM school_temporary_permissions t JOIN school_members m ON m.school_id=t.school_id AND m.user_id=t.user_id AND m.status='ACTIVE' WHERE t.school_id=? AND t.expires_at>? ORDER BY t.expires_at,t.user_id,t.permission LIMIT 500`).bind(schoolId,nowIso()).all()).results;}
export async function grantTemporaryPermission(env:Env,user:AuthUser,schoolId:string,targetId:string,permission:SchoolPermission,expiresAt:string){const school=await requireSchoolOwner(env,user,schoolId);const time=Date.parse(expiresAt),now=Date.now();if(school.owner_user_id===targetId||!all.includes(permission)||!Number.isFinite(time)||time<=now||time>now+90*86400000)throw ApiError.validation('Quyền hoặc thời hạn không hợp lệ; tối đa 90 ngày.');const expiry=new Date(time).toISOString(),stamp=new Date(now).toISOString();const guard=`EXISTS(SELECT 1 FROM schools s JOIN school_members m ON m.school_id=s.id JOIN users u ON u.id=m.user_id WHERE s.id=? AND s.owner_user_id=? AND s.status='APPROVED' AND m.user_id=? AND m.role='TEACHER' AND m.status='ACTIVE' AND u.status='ACTIVE' AND u.role IN ('TEACHER','MENTOR'))`;const results=await env.DB.batch([
 env.DB.prepare(`INSERT INTO school_temporary_permissions(school_id,user_id,permission,expires_at,granted_by,granted_at) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(school_id,user_id,permission) DO UPDATE SET expires_at=excluded.expires_at,granted_by=excluded.granted_by,granted_at=excluded.granted_at`).bind(schoolId,targetId,permission,expiry,user.id,stamp,schoolId,user.id,targetId),
 env.DB.prepare(`INSERT INTO admin_audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at) SELECT ?,?,'SCHOOL_TEMP_GRANT','school',?,?,? WHERE ${guard}`).bind(newId('aud'),user.id,schoolId,JSON.stringify({userId:targetId,permission,expiresAt:expiry}),stamp,schoolId,user.id,targetId),
 ]);if(!results[0]?.meta.changes||!results[1]?.meta.changes)throw ApiError.conflict('Nhân sự hoặc quyền đại diện đã thay đổi.');}
export async function revokeTemporaryPermission(env:Env,user:AuthUser,schoolId:string,targetId:string,permission:SchoolPermission){await requireSchoolOwner(env,user,schoolId);const now=nowIso();const result=await env.DB.batch([env.DB.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at) SELECT ?,?,'SCHOOL_TEMP_REVOKE','school',?,?,? WHERE EXISTS(SELECT 1 FROM school_temporary_permissions WHERE school_id=? AND user_id=? AND permission=?)").bind(newId('aud'),user.id,schoolId,JSON.stringify({userId:targetId,permission}),now,schoolId,targetId,permission),env.DB.prepare('DELETE FROM school_temporary_permissions WHERE school_id=? AND user_id=? AND permission=?').bind(schoolId,targetId,permission)]);if(!result[0]?.meta.changes)throw ApiError.notFound();}
