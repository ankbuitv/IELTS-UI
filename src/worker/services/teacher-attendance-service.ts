import {requireDuty} from './co-teacher-duties-service';
import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { requireClassroomAccess } from './teacher-service';

export function validAttendanceDate(date:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===date;
}
export async function readAttendance(env:Env,user:AuthUser,classId:string,date:string) {
  if(!validAttendanceDate(date))throw ApiError.validation('Ngày không hợp lệ.');
  await requireDuty(env,user,classId,'attendance');
  const classroom=await requireClassroomAccess(env,user,classId);
  const students=await env.DB.prepare(`SELECT cm.user_id,u.email,p.display_name,cm.status AS member_status,a.status
    FROM classroom_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN user_profiles p ON p.user_id=cm.user_id
    LEFT JOIN classroom_attendance a ON a.classroom_id=cm.classroom_id AND a.student_id=cm.user_id AND a.attendance_date=?
    WHERE cm.classroom_id=? AND cm.role='STUDENT' AND (cm.status='ACTIVE' OR a.status IS NOT NULL)
    ORDER BY COALESCE(p.display_name,u.email)`).bind(date,classId).all();
  const dates=await env.DB.prepare(`SELECT attendance_date,COUNT(*) AS total FROM classroom_attendance WHERE classroom_id=? GROUP BY attendance_date ORDER BY attendance_date DESC LIMIT 180`).bind(classId).all();
  return {classroom,students:students.results,dates:dates.results};
}
export async function saveAttendance(env:Env,user:AuthUser,classId:string,date:string,rows:Array<{studentId:string;status:'PRESENT'|'ABSENT'|'LATE'|'UNMARKED'}>) {
  if(!validAttendanceDate(date))throw ApiError.validation('Ngày không hợp lệ.');
  await requireDuty(env,user,classId,'attendance');
  const classroom=await requireClassroomAccess(env,user,classId);
  if(classroom.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ; không thể sửa điểm danh.');
  if(new Set(rows.map(r=>r.studentId)).size!==rows.length)throw ApiError.validation('Danh sách học viên bị trùng.');
  const members=await env.DB.prepare("SELECT user_id FROM classroom_members WHERE classroom_id=? AND role='STUDENT' AND status='ACTIVE'").bind(classId).all<{user_id:string}>();
  const valid=new Set(members.results.map(x=>x.user_id));
  if(rows.some(row=>!valid.has(row.studentId)))throw ApiError.validation('Danh sách đã thay đổi. Làm mới để kiểm tra học viên.');
  const time=nowIso();
  const statements=rows.map(row=>row.status==='UNMARKED'
    ? env.DB.prepare(`DELETE FROM classroom_attendance WHERE classroom_id=? AND student_id=? AND attendance_date=? AND EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=? AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE')`).bind(classId,row.studentId,date,classId,row.studentId)
    : env.DB.prepare(`INSERT INTO classroom_attendance(classroom_id,student_id,attendance_date,status,updated_by,updated_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=? AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE')
      ON CONFLICT(classroom_id,student_id,attendance_date) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(classId,row.studentId,date,row.status,user.id,time,classId,row.studentId));
  if(statements.length)await env.DB.batch(statements);
}
/** Aggregates saved historical marks, including learners who have since left. */
export async function attendanceTrend(env:Env,user:AuthUser,classId:string,from:string,to:string) {
 if(!validAttendanceDate(from)||!validAttendanceDate(to)||from>to||(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000>365)throw ApiError.validation('Chọn khoảng ngày hợp lệ tối đa 366 ngày.');
 await requireDuty(env,user,classId,'attendance');await requireClassroomAccess(env,user,classId);
 return (await env.DB.prepare(`SELECT attendance_date,status,COUNT(*) AS count FROM classroom_attendance WHERE classroom_id=? AND attendance_date BETWEEN ? AND ? GROUP BY attendance_date,status ORDER BY attendance_date`).bind(classId,from,to).all()).results;
}
