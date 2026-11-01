import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { canReviewSchoolApplications, requireSchoolOwner, validateLogo } from './school-service';

/** Explicit links are counted only while the class owner remains active at the approved school. */
export async function schoolOverview(env:Env,user:AuthUser) {
  if (!await canReviewSchoolApplications(env,user)) throw ApiError.forbidden('Chỉ admin hoặc cán bộ được chỉ định được xem báo cáo.');
  const rows=await env.DB.prepare(`SELECT s.id,s.name,s.address,s.status,s.created_at,
    (SELECT COUNT(*) FROM school_members m WHERE m.school_id=s.id AND m.status='ACTIVE' AND m.role IN ('OWNER','TEACHER')) AS staff_count,
    (SELECT COUNT(*) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' WHERE l.school_id=s.id AND c.status='ACTIVE') AS class_count,
    (SELECT COUNT(DISTINCT cm.user_id) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' JOIN classroom_members cm ON cm.classroom_id=c.id AND cm.role='STUDENT' AND cm.status='ACTIVE' WHERE l.school_id=s.id AND c.status='ACTIVE') AS student_count,
    (SELECT COUNT(*) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' JOIN assignments a ON a.classroom_id=c.id AND a.status IN ('ACTIVE','CLOSED') WHERE l.school_id=s.id) AS assignment_count,
    (SELECT COUNT(*) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' JOIN assignments a ON a.classroom_id=c.id AND a.status IN ('ACTIVE','CLOSED') JOIN classroom_members cm ON cm.classroom_id=c.id AND cm.role='STUDENT' AND cm.status='ACTIVE' WHERE l.school_id=s.id) AS assigned_count,
    (SELECT COUNT(*) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' JOIN assignments a ON a.classroom_id=c.id AND a.status IN ('ACTIVE','CLOSED') JOIN classroom_members cm ON cm.classroom_id=c.id AND cm.role='STUDENT' AND cm.status='ACTIVE' WHERE l.school_id=s.id AND EXISTS (SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=cm.user_id AND t.status IN ('SUBMITTED','EXPIRED'))) AS submitted_count,
    (SELECT AVG(t.estimated_band) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' JOIN school_members sm ON sm.school_id=l.school_id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' JOIN assignments a ON a.classroom_id=c.id AND a.status IN ('ACTIVE','CLOSED') JOIN classroom_members cm ON cm.classroom_id=c.id AND cm.role='STUDENT' AND cm.status='ACTIVE' JOIN attempts t ON t.id=(SELECT t2.id FROM attempts t2 WHERE t2.assignment_id=a.id AND t2.user_id=cm.user_id AND t2.status IN ('SUBMITTED','EXPIRED') AND t2.estimated_band IS NOT NULL ORDER BY t2.submitted_at DESC,t2.id DESC LIMIT 1) WHERE l.school_id=s.id) AS average_band
    FROM schools s ORDER BY s.created_at DESC`).all();
  return rows.results;
}
export async function eligibleSchoolClasses(env:Env,user:AuthUser,schoolId:string) {
  await requireSchoolOwner(env,user,schoolId);
  return (await env.DB.prepare(`SELECT c.id,c.name,c.status,p.display_name AS teacher_name,u.email AS teacher_email,l.school_id AS linked_school_id
    FROM classrooms c JOIN school_members sm ON sm.school_id=? AND sm.user_id=c.teacher_id AND sm.status='ACTIVE'
    JOIN users u ON u.id=c.teacher_id LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN school_classroom_links l ON l.classroom_id=c.id
    WHERE c.status='ACTIVE' ORDER BY c.name`).bind(schoolId).all()).results;
}
export async function setSchoolClassLink(env:Env,user:AuthUser,schoolId:string,classroomId:string,linked:boolean) {
  await requireSchoolOwner(env,user,schoolId);
  if(linked) {
    const eligible=await env.DB.prepare(`SELECT 1 AS ok FROM classrooms c JOIN school_members sm ON sm.school_id=? AND sm.user_id=c.teacher_id AND sm.status='ACTIVE' WHERE c.id=? AND c.status='ACTIVE'`).bind(schoolId,classroomId).first();
    if(!eligible)throw ApiError.forbidden('Lớp phải thuộc giáo viên đang hoạt động tại trường.');
    const existing=await env.DB.prepare('SELECT school_id FROM school_classroom_links WHERE classroom_id=?').bind(classroomId).first<{school_id:string}>();
    if(existing && existing.school_id!==schoolId)throw ApiError.conflict('Lớp đã được liên kết với trường khác.');
    const result=await env.DB.prepare(`INSERT INTO school_classroom_links(classroom_id,school_id,linked_by,linked_at) VALUES(?,?,?,?) ON CONFLICT(classroom_id) DO UPDATE SET school_id=excluded.school_id WHERE school_classroom_links.school_id=excluded.school_id`).bind(classroomId,schoolId,user.id,nowIso()).run();
    if(!result.meta.changes)throw ApiError.conflict('Lớp đã được liên kết với trường khác.');
  } else await env.DB.prepare('DELETE FROM school_classroom_links WHERE classroom_id=? AND school_id=?').bind(classroomId,schoolId).run();
  await recordAudit(env,{actorUserId:user.id,action:linked?'SCHOOL_CLASS_LINK':'SCHOOL_CLASS_UNLINK',entityType:'school',entityId:schoolId,metadata:{classroomId}});
}
export async function getSchoolBanner(env:Env,user:AuthUser,schoolId:string) {
  await requireSchoolOwner(env,user,schoolId);
  return env.DB.prepare('SELECT title,message,theme,image_mime,image_b64,active,updated_at FROM school_banners WHERE school_id=?').bind(schoolId).first();
}
export async function saveSchoolBanner(env:Env,user:AuthUser,schoolId:string,input:{title:string;message:string;theme:'blue'|'green'|'amber';active:boolean;image:{mime:string;base64:string}|null}) {
  await requireSchoolOwner(env,user,schoolId);
  if(input.image)validateLogo(input.image.mime,input.image.base64);
  await env.DB.prepare(`INSERT INTO school_banners(school_id,title,message,theme,image_mime,image_b64,active,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(school_id) DO UPDATE SET title=excluded.title,message=excluded.message,theme=excluded.theme,image_mime=excluded.image_mime,image_b64=excluded.image_b64,active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(schoolId,input.title,input.message,input.theme,input.image?.mime??null,input.image?.base64??null,input.active?1:0,user.id,nowIso()).run();
  await recordAudit(env,{actorUserId:user.id,action:'SCHOOL_BANNER_SAVE',entityType:'school',entityId:schoolId});
}
export async function studentSchoolBanners(env:Env,user:AuthUser) {
  if(user.role!=='STUDENT')throw ApiError.forbidden();
  return (await env.DB.prepare(`SELECT DISTINCT s.id AS school_id,s.name AS school_name,b.title,b.message,b.theme,b.image_mime,b.image_b64,b.updated_at
    FROM school_banners b JOIN schools s ON s.id=b.school_id AND s.status='APPROVED'
    JOIN school_classroom_links l ON l.school_id=s.id JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE'
    JOIN school_members sm ON sm.school_id=s.id AND sm.user_id=c.teacher_id AND sm.status='ACTIVE'
    JOIN classroom_members cm ON cm.classroom_id=c.id AND cm.user_id=? AND cm.role='STUDENT' AND cm.status='ACTIVE'
    WHERE b.active=1 ORDER BY b.updated_at DESC`).bind(user.id).all()).results;
}
