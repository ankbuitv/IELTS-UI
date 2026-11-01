import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { recordAudit } from '../lib/audit';

type School = { id: string; name: string; address: string; contact_email: string; owner_user_id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; review_note: string | null; created_at: string };

export async function listMySchools(env: Env, user: AuthUser) {
  const result = await env.DB.prepare(`SELECT s.id, s.name, s.address, s.contact_email, s.status, s.review_note, s.created_at,
      m.role AS member_role, m.status AS member_status
    FROM school_members m JOIN schools s ON s.id = m.school_id
    WHERE m.user_id = ? ORDER BY s.created_at DESC LIMIT 200`).bind(user.id).all();
  return result.results;
}

/** This is a separately granted capability; an ordinary teacher or learner cannot self-promote. */
export async function isSchoolManager(env: Env, user: AuthUser): Promise<boolean> {
  if (!['TEACHER','MENTOR','ADMIN'].includes(user.role)) return false;
  return !!(await env.DB.prepare('SELECT 1 AS ok FROM school_managers WHERE user_id=?').bind(user.id).first());
}

export async function grantSchoolManager(env: Env, actor: AuthUser, email: string) {
  if (actor.role !== 'ADMIN') throw ApiError.forbidden('Chỉ admin hệ thống được cấp quyền quản lý trường.');
  const target = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=? AND status='ACTIVE' AND role IN ('TEACHER','MENTOR','ADMIN')").bind(email.toLowerCase()).first<{id:string}>();
  if (!target) throw ApiError.notFound('Cần tài khoản giáo viên, mentor hoặc admin đang hoạt động.');
  await env.DB.prepare('INSERT OR IGNORE INTO school_managers(user_id,granted_by,granted_at) VALUES(?,?,?)').bind(target.id,actor.id,nowIso()).run();
  await recordAudit(env,{actorUserId:actor.id,action:'SCHOOL_MANAGER_GRANT',entityType:'user',entityId:target.id});
}

export async function listSchoolManagers(env: Env, actor: AuthUser) {
  if (actor.role !== 'ADMIN') throw ApiError.forbidden();
  return (await env.DB.prepare('SELECT u.id,u.email,u.role,p.display_name,m.granted_at FROM school_managers m JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id ORDER BY m.granted_at DESC').all()).results;
}

export async function revokeSchoolManager(env: Env, actor: AuthUser, userId: string) {
  if (actor.role !== 'ADMIN') throw ApiError.forbidden();
  // Existing owners keep access to their own schools, but cannot create more.
  await env.DB.prepare('DELETE FROM school_managers WHERE user_id=?').bind(userId).run();
  await recordAudit(env,{actorUserId:actor.id,action:'SCHOOL_MANAGER_REVOKE',entityType:'user',entityId:userId});
}

export async function registerSchool(env: Env, user: AuthUser, input: { name: string; address: string; contactEmail: string }) {
  if (!await isSchoolManager(env,user)) throw ApiError.forbidden('Chỉ tài khoản được cấp quyền quản lý trường mới có thể đăng ký trường.');
  const id = newId('sch'); const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO schools (id,name,address,contact_email,owner_user_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'PENDING',?,?)`).bind(id, input.name, input.address, input.contactEmail.toLowerCase(), user.id, now, now),
    env.DB.prepare(`INSERT INTO school_members (id,school_id,user_id,role,status,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?)`).bind(newId('sm'), id, user.id, now, now),
  ]);
  await recordAudit(env, { actorUserId: user.id, action: 'SCHOOL_REGISTER', entityType: 'school', entityId: id });
  return { id };
}

export async function listSchoolApplications(env: Env, user: AuthUser) {
  if (user.role !== 'ADMIN') throw ApiError.forbidden();
  return (await env.DB.prepare(`SELECT s.id,s.name,s.address,s.contact_email,s.status,s.review_note,s.created_at,
    s.owner_user_id,u.email AS owner_email FROM schools s JOIN users u ON u.id=s.owner_user_id
    ORDER BY CASE WHEN s.status='PENDING' THEN 0 ELSE 1 END,s.created_at DESC LIMIT 200`).all()).results;
}

export async function reviewSchool(env: Env, user: AuthUser, id: string, status: 'APPROVED' | 'REJECTED', note: string) {
  if (user.role !== 'ADMIN') throw ApiError.forbidden();
  if (status === 'APPROVED') { const owner = await env.DB.prepare(`SELECT u.role FROM schools s JOIN users u ON u.id=s.owner_user_id WHERE s.id=?`).bind(id).first<{role:string}>(); if (!owner || !['TEACHER','MENTOR','ADMIN'].includes(owner.role)) throw ApiError.conflict('Đại diện trường phải là giáo viên, mentor hoặc quản trị viên.'); }
  if (status === 'REJECTED' && !note.trim()) throw ApiError.validation('Vui lòng nhập lý do từ chối.');
  const result = await env.DB.prepare(`UPDATE schools SET status=?, review_note=?, reviewed_by=?, reviewed_at=?, updated_at=?
    WHERE id=? AND status='PENDING'`).bind(status, note || null, user.id, nowIso(), nowIso(), id).run();
  if (!result.meta.changes) throw ApiError.conflict('Trường không tồn tại hoặc đã được xử lý.');
  await recordAudit(env, { actorUserId: user.id, action: `SCHOOL_${status}`, entityType: 'school', entityId: id, metadata: { note } });
}

async function requireSchoolOwner(env: Env, user: AuthUser, id: string) {
  if (!['TEACHER','MENTOR','ADMIN'].includes(user.role)) throw ApiError.forbidden('Tài khoản không có quyền đại diện trường.');
  const school = await env.DB.prepare('SELECT * FROM schools WHERE id=?').bind(id).first<School>();
  if (!school || school.owner_user_id !== user.id) throw ApiError.forbidden('Chỉ đại diện trường mới quản lý giáo viên.');
  if (school.status !== 'APPROVED') throw ApiError.conflict('Trường cần được duyệt trước.');
  return school;
}

export async function listSchoolMembers(env: Env, user: AuthUser, id: string) {
  await requireSchoolOwner(env, user, id);
  return (await env.DB.prepare(`SELECT m.user_id,m.role,m.status,m.created_at,u.email,p.display_name
    FROM school_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
    WHERE m.school_id=? ORDER BY m.created_at LIMIT 200`).bind(id).all()).results;
}

export async function inviteTeacher(env: Env, user: AuthUser, id: string, email: string) {
  await requireSchoolOwner(env, user, id);
  const teacher = await env.DB.prepare(`SELECT id FROM users WHERE lower(email)=? AND role IN ('TEACHER','MENTOR') AND status='ACTIVE'`).bind(email.toLowerCase()).first<{ id: string }>();
  if (!teacher) throw ApiError.notFound('Không tìm thấy tài khoản giáo viên hoặc mentor đang hoạt động với email này.');
  const existing = await env.DB.prepare('SELECT status,role FROM school_members WHERE school_id=? AND user_id=?').bind(id, teacher.id).first<{ status: string; role: string }>();
  if (existing?.role === 'OWNER' || existing?.status === 'ACTIVE' || existing?.status === 'INVITED') throw ApiError.conflict('Tài khoản này đã là thành viên hoặc đã được mời.');
  const now = nowIso();
  const result = await env.DB.prepare(`INSERT INTO school_members (id,school_id,user_id,role,status,created_at,updated_at)
    VALUES (?,?,?,'TEACHER','INVITED',?,?) ON CONFLICT(school_id,user_id) DO UPDATE SET status='INVITED',updated_at=excluded.updated_at
    WHERE school_members.role='TEACHER' AND school_members.status IN ('DECLINED','REMOVED')`).bind(newId('sm'),id,teacher.id,now,now).run();
  if (!result.meta.changes) throw ApiError.conflict('Lời mời đã tồn tại hoặc thành viên đã được kích hoạt.');
  await recordAudit(env, { actorUserId: user.id, action: 'SCHOOL_TEACHER_INVITE', entityType: 'school', entityId: id, metadata: { userId: teacher.id } });
}

/** Create a teacher login and issue a school invitation; membership still requires acceptance. */
export async function createSchoolTeacher(env: Env, actor: AuthUser, schoolId: string, input: {email:string;displayName:string;password:string}) {
  await requireSchoolOwner(env,actor,schoolId);
  const {createUser} = await import('./auth-service');
  const teacher=await createUser(env,{...input,role:'TEACHER',createdBy:actor.id});
  try { await inviteTeacher(env,actor,schoolId,teacher.email); }
  catch { throw ApiError.conflict('Tài khoản đã được tạo nhưng chưa gửi được lời mời. Hãy mời lại bằng email.'); }
  await recordAudit(env,{actorUserId:actor.id,action:'SCHOOL_TEACHER_CREATE',entityType:'school',entityId:schoolId,metadata:{userId:teacher.id}});
  return {id:teacher.id,email:teacher.email};
}

export async function respondSchoolInvitation(env: Env, user: AuthUser, id: string, accept: boolean) {
  if (user.role !== 'TEACHER' && user.role !== 'MENTOR') throw ApiError.forbidden('Chỉ giáo viên hoặc mentor mới có thể tham gia.');
  const result = await env.DB.prepare(`UPDATE school_members SET status=?,updated_at=? WHERE school_id=? AND user_id=? AND status='INVITED' AND role='TEACHER'
    AND EXISTS (SELECT 1 FROM schools s WHERE s.id=school_members.school_id AND s.status='APPROVED')`)
    .bind(accept ? 'ACTIVE' : 'DECLINED', nowIso(), id, user.id).run();
  if (!result.meta.changes) throw ApiError.conflict('Lời mời không còn hiệu lực.');
  await recordAudit(env, { actorUserId: user.id, action: accept ? 'SCHOOL_INVITE_ACCEPT' : 'SCHOOL_INVITE_DECLINE', entityType: 'school', entityId: id });
}

export async function removeSchoolMember(env: Env, user: AuthUser, id: string, memberId: string) {
  await requireSchoolOwner(env, user, id);
  const result = await env.DB.prepare(`UPDATE school_members SET status='REMOVED',updated_at=?
    WHERE school_id=? AND user_id=? AND role='TEACHER' AND status IN ('ACTIVE','INVITED')`)
    .bind(nowIso(), id, memberId).run();
  if (!result.meta.changes) throw ApiError.conflict('Thành viên hoặc lời mời không còn hiệu lực.');
  await recordAudit(env, { actorUserId: user.id, action: 'SCHOOL_MEMBER_REMOVE', entityType: 'school', entityId: id, metadata: { userId: memberId } });
}

/** A small, raster-only logo avoids loading third-party trackers in classrooms. */
export async function saveSchoolLogo(env: Env, user: AuthUser, id: string, mime: string, base64: string) {
  await requireSchoolOwner(env, user, id);
  validateLogo(mime,base64);
  await env.DB.prepare(`INSERT INTO school_logos (school_id,mime,data_b64,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(school_id) DO UPDATE SET mime=excluded.mime,data_b64=excluded.data_b64,updated_at=excluded.updated_at`)
    .bind(id,mime,base64,nowIso()).run();
  await recordAudit(env,{actorUserId:user.id,action:'SCHOOL_LOGO_UPDATE',entityType:'school',entityId:id});
}

export function validateLogo(mime: string, base64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 140_000) throw ApiError.validation('Logo không hợp lệ hoặc lớn hơn 100 KB.');
  let bytes: Uint8Array;
  try { const binary = atob(base64); bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); } catch { throw ApiError.validation('Dữ liệu logo không hợp lệ.'); }
  if (bytes.length > 100_000) throw ApiError.validation('Logo phải nhỏ hơn 100 KB.');
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  const jpeg = bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if (!(mime==='image/png' && png || mime==='image/jpeg' && jpeg || mime==='image/webp' && webp)) throw ApiError.validation('Chỉ nhận ảnh PNG, JPEG hoặc WebP hợp lệ.');
}

export async function getSchoolLogo(env: Env, id: string) {
  return env.DB.prepare(`SELECT l.mime,l.data_b64 FROM school_logos l JOIN schools s ON s.id=l.school_id WHERE s.id=? AND s.status='APPROVED'`)
    .bind(id).first<{mime:string;data_b64:string}>();
}
