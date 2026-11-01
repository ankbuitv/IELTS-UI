import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { requireActiveSchoolStaff } from './school-operations-service';

const MAX_BYTES=512_000;
async function requireAuthor(env:Env,user:AuthUser,schoolId:string,planId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  if(!await env.DB.prepare('SELECT 1 FROM school_lesson_plans WHERE id=? AND school_id=? AND author_id=?').bind(planId,schoolId,user.id).first())throw ApiError.notFound();
}
export async function listLessonAttachments(env:Env,user:AuthUser,schoolId:string,planId:string) {
  await requireAuthor(env,user,schoolId,planId);
  return (await env.DB.prepare('SELECT id,filename,bytes,created_at FROM school_lesson_attachments WHERE school_id=? AND plan_id=? AND author_id=? AND active=1 ORDER BY created_at,id').bind(schoolId,planId,user.id).all()).results;
}
export async function addLessonAttachment(env:Env,user:AuthUser,schoolId:string,planId:string,filename:string,base64:string) {
  await requireAuthor(env,user,schoolId,planId);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length%4!==0)throw ApiError.validation('Dữ liệu file không hợp lệ.');
  let bytes:number;try{bytes=atob(base64).length;}catch{throw ApiError.validation('Dữ liệu file không hợp lệ.');}
  if(!bytes || bytes>MAX_BYTES)throw ApiError.validation('File phải nhỏ hơn 500 KB.');
  const safe=[...filename].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c==='\\'?'_':c).join('').trim();
  if(!safe)throw ApiError.validation('Tên file không hợp lệ.');
  const id=newId('lpa');
  const result=await env.DB.prepare(`INSERT INTO school_lesson_attachments(id,plan_id,school_id,author_id,filename,data_b64,bytes,active,created_at)
    SELECT ?,p.id,p.school_id,p.author_id,?,?,?,1,? FROM school_lesson_plans p WHERE p.id=? AND p.school_id=? AND p.author_id=?
    AND (SELECT COUNT(*) FROM school_lesson_attachments a WHERE a.plan_id=p.id AND a.active=1)<5`).bind(id,safe,base64,bytes,nowIso(),planId,schoolId,user.id).run();
  if(!result.meta.changes)throw ApiError.conflict('Tối đa 5 file cho mỗi giáo án hoặc giáo án không còn tồn tại.');
  return {id};
}
export async function removeLessonAttachment(env:Env,user:AuthUser,schoolId:string,planId:string,fileId:string) {
  await requireAuthor(env,user,schoolId,planId);
  const results=await env.DB.batch([
    env.DB.prepare('UPDATE school_lesson_attachments SET active=0 WHERE id=? AND plan_id=? AND school_id=? AND author_id=? AND active=1').bind(fileId,planId,schoolId,user.id),
    env.DB.prepare(`DELETE FROM school_lesson_attachments WHERE id=? AND plan_id=? AND school_id=? AND author_id=? AND active=0
      AND NOT EXISTS(SELECT 1 FROM school_lesson_submission_attachments sa WHERE sa.attachment_id=school_lesson_attachments.id)`).bind(fileId,planId,schoolId,user.id),
  ]);
  if(!results[0]?.meta.changes)throw ApiError.notFound();
}
export async function readDraftAttachment(env:Env,user:AuthUser,schoolId:string,planId:string,fileId:string) {
  await requireAuthor(env,user,schoolId,planId);
  const file=await env.DB.prepare('SELECT filename,data_b64 FROM school_lesson_attachments WHERE id=? AND plan_id=? AND school_id=? AND author_id=? AND active=1').bind(fileId,planId,schoolId,user.id).first<{filename:string;data_b64:string}>();
  if(!file)throw ApiError.notFound();return file;
}
/** Author, school owner, group leader or REVIEW_ALL staff can read the submitted snapshot only. */
async function requireSubmission(env:Env,user:AuthUser,schoolId:string,submissionId:string) {
  await requireActiveSchoolStaff(env,user,schoolId);
  const allowed=await env.DB.prepare(`SELECT 1 FROM school_lesson_submissions sub JOIN schools s ON s.id=sub.school_id JOIN school_subject_groups g ON g.id=sub.group_id
    WHERE sub.id=? AND sub.school_id=? AND (sub.author_id=? OR s.owner_user_id=? OR g.leader_id=? OR EXISTS(SELECT 1 FROM school_staff_permissions sp WHERE sp.school_id=sub.school_id AND sp.user_id=? AND sp.permission='REVIEW_ALL'))`).bind(submissionId,schoolId,user.id,user.id,user.id,user.id).first();
  if(!allowed)throw ApiError.notFound();
}
export async function listSubmissionAttachments(env:Env,user:AuthUser,schoolId:string,submissionId:string) {
  await requireSubmission(env,user,schoolId,submissionId);
  return (await env.DB.prepare(`SELECT a.id,a.filename,a.bytes,a.created_at FROM school_lesson_submission_attachments sa JOIN school_lesson_attachments a ON a.id=sa.attachment_id WHERE sa.submission_id=? ORDER BY a.created_at,a.id`).bind(submissionId).all()).results;
}
export async function readSubmissionAttachment(env:Env,user:AuthUser,schoolId:string,submissionId:string,fileId:string) {
  await requireSubmission(env,user,schoolId,submissionId);
  const file=await env.DB.prepare(`SELECT a.filename,a.data_b64 FROM school_lesson_submission_attachments sa JOIN school_lesson_attachments a ON a.id=sa.attachment_id WHERE sa.submission_id=? AND a.id=?`).bind(submissionId,fileId).first<{filename:string;data_b64:string}>();
  if(!file)throw ApiError.notFound();return file;
}
