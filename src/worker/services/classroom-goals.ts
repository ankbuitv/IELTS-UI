import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {newId,nowIso} from '../lib/ids';
import {requireClassroomAccess} from './teacher-service';
import {assignmentEligible} from './assignment-audience';
type Input={title:string;targetPercent:number;dueDate:string|null};
const ownerGuard=`EXISTS (SELECT 1 FROM classrooms c WHERE c.id=? AND c.status='ACTIVE' AND (c.teacher_id=? OR ?='ADMIN'))`;
export async function listClassGoals(env:Env,user:AuthUser,classId:string){
 const classroom=await requireClassroomAccess(env,user,classId);
 const goals=(await env.DB.prepare('SELECT id,title,target_percent,due_date,created_at,updated_at FROM classroom_goals WHERE classroom_id=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(classId).all()).results;
 const aggregate=await env.DB.prepare(`SELECT COUNT(*) AS assigned_count, SUM(CASE WHEN EXISTS (SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=m.user_id AND t.status IN ('SUBMITTED','EXPIRED')) THEN 1 ELSE 0 END) AS submitted_count FROM assignments a JOIN classroom_members m ON m.classroom_id=a.classroom_id AND m.role='STUDENT' AND m.status='ACTIVE' WHERE a.classroom_id=? AND a.status IN ('ACTIVE','CLOSED') AND ${assignmentEligible('a','m.user_id')}`).bind(classId).first<{assigned_count:number;submitted_count:number|null}>();
 return {goals,aggregate:{assigned:aggregate?.assigned_count??0,submitted:aggregate?.submitted_count??0},status:classroom.status};
}
export async function saveClassGoal(env:Env,user:AuthUser,classId:string,id:string|null,input:Input){
 const c=await requireClassroomAccess(env,user,classId,{requireOwner:true});if(c.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ, chỉ có thể xem.');
 const title=input.title.trim();if(!title||title.length>200||!Number.isInteger(input.targetPercent)||input.targetPercent<1||input.targetPercent>100)throw ApiError.validation('Mục tiêu không hợp lệ.');
 if(input.dueDate){const d=new Date(`${input.dueDate}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==input.dueDate)throw ApiError.validation('Ngày mục tiêu không hợp lệ.');}
 const now=nowIso(),goalId=id??newId('cg');
 const res=id?await env.DB.prepare(`UPDATE classroom_goals SET title=?,target_percent=?,due_date=?,updated_at=? WHERE id=? AND classroom_id=? AND ${ownerGuard}`).bind(title,input.targetPercent,input.dueDate,now,id,classId,classId,user.id,user.role).run():await env.DB.prepare(`INSERT INTO classroom_goals(id,classroom_id,title,target_percent,due_date,created_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${ownerGuard} AND (SELECT count(*) FROM classroom_goals WHERE classroom_id=?)<50`).bind(goalId,classId,title,input.targetPercent,input.dueDate,user.id,now,now,classId,user.id,user.role,classId).run();
 if(!res.meta.changes){if(id)throw ApiError.notFound('Không tìm thấy mục tiêu hoặc quyền đã thay đổi.');throw ApiError.conflict('Lớp không khả dụng hoặc đã có 50 mục tiêu.');}return {id:goalId};
}
export async function deleteClassGoal(env:Env,user:AuthUser,classId:string,id:string){
 const c=await requireClassroomAccess(env,user,classId,{requireOwner:true});if(c.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ, chỉ có thể xem.');
 const r=await env.DB.prepare(`DELETE FROM classroom_goals WHERE id=? AND classroom_id=? AND ${ownerGuard}`).bind(id,classId,classId,user.id,user.role).run();if(!r.meta.changes)throw ApiError.notFound('Không tìm thấy mục tiêu hoặc quyền đã thay đổi.');
}
