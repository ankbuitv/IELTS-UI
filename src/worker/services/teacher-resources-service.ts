import {requireDuty} from './co-teacher-duties-service';
import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {newId,nowIso} from '../lib/ids';
import {requireClassroomAccess} from './teacher-service';

async function validateShare(env:Env,user:AuthUser,classId:string|null) {
 if(!classId)return;
 await requireDuty(env,user,classId,'resources');
 const classroom=await requireClassroomAccess(env,user,classId);
 if(classroom.status!=='ACTIVE')throw ApiError.conflict('Chỉ có thể chia sẻ vào lớp đang hoạt động.');
}
export async function listResources(env:Env,user:AuthUser) {
 return (await env.DB.prepare(`SELECT r.id,r.filename,r.subject,r.topic,r.shared_classroom_id,r.bytes,r.created_at,r.updated_at,c.name AS classroom_name
 FROM teacher_resources r LEFT JOIN classrooms c ON c.id=r.shared_classroom_id WHERE r.author_id=? ORDER BY r.updated_at DESC,r.id DESC LIMIT 25`).bind(user.id).all()).results;
}
export async function createResource(env:Env,user:AuthUser,input:{filename:string;subject:string;topic:string;classroomId:string|null;base64:string}) {
 await validateShare(env,user,input.classroomId);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw ApiError.validation('Dữ liệu tệp không hợp lệ.');
 let size:number;try{size=atob(input.base64).length;}catch{throw ApiError.validation('Dữ liệu tệp không hợp lệ.');}
 if(!size||size>512_000)throw ApiError.validation('Tệp cần có nội dung và tối đa 500 KB.');
 const name=[...input.filename].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c==='\\'?'_':c).join('').trim();if(!name)throw ApiError.validation('Tên tệp không hợp lệ.');
 const id=newId('res'),now=nowIso();const result=await env.DB.prepare(`INSERT INTO teacher_resources(id,author_id,filename,subject,topic,shared_classroom_id,data_b64,bytes,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM teacher_resources WHERE author_id=?)<25`).bind(id,user.id,name,input.subject,input.topic,input.classroomId,input.base64,size,now,now,user.id).run();
 if(!result.meta.changes)throw ApiError.conflict('Thư viện tối đa 25 tệp.');return id;
}
export async function updateResource(env:Env,user:AuthUser,id:string,input:{subject:string;topic:string;classroomId:string|null}) {
 await validateShare(env,user,input.classroomId);
 const result=await env.DB.prepare('UPDATE teacher_resources SET subject=?,topic=?,shared_classroom_id=?,updated_at=? WHERE id=? AND author_id=?').bind(input.subject,input.topic,input.classroomId,nowIso(),id,user.id).run();
 if(!result.meta.changes)throw ApiError.notFound();
}
export async function deleteResource(env:Env,user:AuthUser,id:string) {const result=await env.DB.prepare('DELETE FROM teacher_resources WHERE id=? AND author_id=?').bind(id,user.id).run();if(!result.meta.changes)throw ApiError.notFound();}
export async function readOwnResource(env:Env,user:AuthUser,id:string) {const file=await env.DB.prepare('SELECT filename,data_b64 FROM teacher_resources WHERE id=? AND author_id=?').bind(id,user.id).first();if(!file)throw ApiError.notFound();return file;}
async function canViewClass(env:Env,user:AuthUser,classId:string) {
 if(user.role==='TEACHER'||user.role==='ADMIN'){await requireClassroomAccess(env,user,classId);return;}
 if(user.role!=='STUDENT')throw ApiError.forbidden();
 const membership=await env.DB.prepare("SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE'").bind(classId,user.id).first();if(!membership)throw ApiError.forbidden();
}
const sharedCondition=`r.shared_classroom_id=c.id AND (r.author_id=c.teacher_id OR EXISTS(SELECT 1 FROM users au WHERE au.id=r.author_id AND au.role='ADMIN' AND au.status='ACTIVE') OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=r.author_id AND m.role='CO_TEACHER' AND m.status='ACTIVE' AND COALESCE((SELECT d.can_resource FROM classroom_co_teacher_duties d WHERE d.member_id=m.id),1)=1))`;
export async function listSharedResources(env:Env,user:AuthUser,classId:string) {
 await canViewClass(env,user,classId);
 return (await env.DB.prepare(`SELECT r.id,r.filename,r.subject,r.topic,r.bytes,r.created_at,COALESCE(p.display_name,u.email) AS author_name FROM teacher_resources r
 JOIN classrooms c ON ${sharedCondition} JOIN users u ON u.id=r.author_id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE c.id=? ORDER BY r.updated_at DESC LIMIT 200`).bind(classId).all()).results;
}
export async function readSharedResource(env:Env,user:AuthUser,classId:string,id:string) {
 await canViewClass(env,user,classId);
 const file=await env.DB.prepare(`SELECT r.filename,r.data_b64 FROM teacher_resources r JOIN classrooms c ON ${sharedCondition} WHERE c.id=? AND r.id=?`).bind(classId,id).first();
 if(!file)throw ApiError.notFound();return file;
}
