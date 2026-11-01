import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { requireClassroomAccess } from './teacher-service';

export async function readSeating(env:Env,user:AuthUser,classId:string) {
 const classroom=await requireClassroomAccess(env,user,classId);
 const students=await env.DB.prepare(`SELECT m.user_id,u.email,p.display_name,s.position FROM classroom_members m
 JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=m.user_id
 LEFT JOIN classroom_seating s ON s.classroom_id=m.classroom_id AND s.student_id=m.user_id
 WHERE m.classroom_id=? AND m.role='STUDENT' AND m.status='ACTIVE'
 ORDER BY s.position IS NULL,s.position,COALESCE(p.display_name,u.email) LIMIT 201`).bind(classId).all();
 return {classroomStatus:classroom.status,students:students.results};
}
export async function saveSeating(env:Env,user:AuthUser,classId:string,studentIds:string[]) {
 const classroom=await requireClassroomAccess(env,user,classId);
 if(classroom.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ; sơ đồ chỗ ngồi chỉ đọc.');
 if(studentIds.length>200||new Set(studentIds).size!==studentIds.length)throw ApiError.validation('Danh sách chỗ ngồi không hợp lệ.');
 const members=await env.DB.prepare("SELECT user_id FROM classroom_members WHERE classroom_id=? AND role='STUDENT' AND status='ACTIVE' LIMIT 201").bind(classId).all<{user_id:string}>();
 const active=new Set(members.results.map(x=>x.user_id));
 if(active.size!==studentIds.length||studentIds.some(id=>!active.has(id)))throw ApiError.conflict('Danh sách học viên đã thay đổi. Hãy tải lại sơ đồ.');
 const statements=[env.DB.prepare('DELETE FROM classroom_seating WHERE classroom_id=?').bind(classId),...studentIds.map((id,index)=>env.DB.prepare(`INSERT INTO classroom_seating(classroom_id,student_id,position)
 SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE')`).bind(classId,id,index,classId,id))];
 await env.DB.batch(statements);
}
