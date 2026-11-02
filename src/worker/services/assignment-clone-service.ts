import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {newId,nowIso} from '../lib/ids';import {requireClassroomAccess} from './teacher-service';
/** Atomically creates whole-class drafts; dates, targets, attempts and feedback are never copied. */
export async function cloneAssignmentToClasses(env:Env,user:AuthUser,sourceId:string,classroomIds:string[]){
 if(!classroomIds.length||classroomIds.length>20||new Set(classroomIds).size!==classroomIds.length)throw ApiError.validation('Chọn 1–20 lớp khác nhau.');
 const source=await env.DB.prepare('SELECT classroom_id,status FROM assignments WHERE id=?').bind(sourceId).first<{classroom_id:string;status:string}>();if(!source)throw ApiError.notFound();await requireClassroomAccess(env,user,source.classroom_id);if(source.status==='ARCHIVED')throw ApiError.conflict('Bài gốc đã lưu trữ.');
 for(const id of classroomIds){const c=await requireClassroomAccess(env,user,id);if(c.status!=='ACTIVE')throw ApiError.conflict('Chỉ tạo bản sao trong lớp đang hoạt động.');}
 const targets=classroomIds.map(classId=>({classId,id:newId('asg')})),json=JSON.stringify(targets),now=nowIso(),admin=+(user.role==='ADMIN');
 const result=await env.DB.prepare(`INSERT INTO assignments(id,classroom_id,teacher_id,test_id,test_version_id,title,instructions,start_at,deadline_at,max_attempts,timing_policy,custom_duration_seconds,mode,integrity_policy_json,result_visibility,allow_reattempt,status,created_at,updated_at)
 SELECT json_extract(j.value,'$.id'),c.id,?,a.test_id,a.test_version_id,a.title,a.instructions,NULL,NULL,a.max_attempts,a.timing_policy,a.custom_duration_seconds,a.mode,a.integrity_policy_json,a.result_visibility,a.allow_reattempt,'DRAFT',?,?
 FROM assignments a JOIN classrooms source ON source.id=a.classroom_id JOIN test_versions v ON v.id=a.test_version_id JOIN tests t ON t.id=v.test_id JOIN json_each(?) j JOIN classrooms c ON c.id=json_extract(j.value,'$.classId')
 WHERE a.id=? AND a.status!='ARCHIVED' AND source.status='ACTIVE' AND v.status='PUBLISHED' AND t.status!='ARCHIVED'
 AND (?=1 OR source.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members sm WHERE sm.classroom_id=source.id AND sm.user_id=? AND sm.role='CO_TEACHER' AND sm.status='ACTIVE'))
 AND (SELECT COUNT(*) FROM classrooms cc WHERE cc.status='ACTIVE' AND cc.id IN (SELECT json_extract(value,'$.classId') FROM json_each(?)) AND (?=1 OR cc.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=cc.id AND m.user_id=? AND m.role='CO_TEACHER' AND m.status='ACTIVE')))=?`).bind(user.id,now,now,json,sourceId,admin,user.id,user.id,json,admin,user.id,user.id,targets.length).run();
 if(Number(result.meta.changes)!==targets.length)throw ApiError.conflict('Quyền truy cập hoặc đề gốc đã thay đổi; chưa tạo bản sao.');return targets;
}
