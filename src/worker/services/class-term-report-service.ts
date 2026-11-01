import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {newId,nowIso} from '../lib/ids';
import {validAttendanceDate} from './teacher-attendance-service';
import {requireClassroomAccess} from './teacher-service';

type Draft={title:string;fromDate:string;toDate:string;feedback:string};
async function teacherAccess(env:Env,user:AuthUser,classId:string,studentId:string,write=false) {
 const c=await requireClassroomAccess(env,user,classId);if(write&&c.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ; báo cáo chỉ đọc.');
 const member=await env.DB.prepare("SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE'").bind(classId,studentId).first();if(!member)throw ApiError.notFound('Học viên không còn thuộc lớp.');return c;
}
export async function readTermReport(env:Env,user:AuthUser,classId:string,studentId:string) {
 const classroom=await teacherAccess(env,user,classId,studentId);
 const draft=await env.DB.prepare('SELECT title,from_date,to_date,feedback,updated_at FROM class_term_report_drafts WHERE classroom_id=? AND student_id=?').bind(classId,studentId).first();
 const releases=await env.DB.prepare('SELECT id,title,from_date,to_date,feedback,summary_json,approved_at FROM class_term_report_releases WHERE classroom_id=? AND student_id=? ORDER BY approved_at DESC,id DESC LIMIT 50').bind(classId,studentId).all();
 return {classroomStatus:classroom.status,draft,releases:releases.results};
}
export async function saveTermReport(env:Env,user:AuthUser,classId:string,studentId:string,draft:Draft) {
 await teacherAccess(env,user,classId,studentId,true);
 if(!validAttendanceDate(draft.fromDate)||!validAttendanceDate(draft.toDate)||draft.fromDate>draft.toDate)throw ApiError.validation('Khoảng ngày báo cáo không hợp lệ.');
 await env.DB.prepare(`INSERT INTO class_term_report_drafts(classroom_id,student_id,title,from_date,to_date,feedback,updated_by,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(classroom_id,student_id) DO UPDATE SET title=excluded.title,from_date=excluded.from_date,to_date=excluded.to_date,feedback=excluded.feedback,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(classId,studentId,draft.title,draft.fromDate,draft.toDate,draft.feedback,user.id,nowIso()).run();
}
export async function releaseTermReport(env:Env,user:AuthUser,classId:string,studentId:string) {
 await teacherAccess(env,user,classId,studentId,true);
 const draft=await env.DB.prepare('SELECT title,from_date,to_date,feedback,updated_at FROM class_term_report_drafts WHERE classroom_id=? AND student_id=?').bind(classId,studentId).first<{title:string;from_date:string;to_date:string;feedback:string;updated_at:string}>();
 if(!draft)throw ApiError.conflict('Hãy lưu bản nháp trước khi duyệt và chia sẻ.');
 const attendance=await env.DB.prepare(`SELECT COUNT(*) AS recorded,SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END) AS present,SUM(CASE WHEN status='ABSENT' THEN 1 ELSE 0 END) AS absent,SUM(CASE WHEN status='LATE' THEN 1 ELSE 0 END) AS late
 FROM classroom_attendance WHERE classroom_id=? AND student_id=? AND attendance_date>=? AND attendance_date<=?`).bind(classId,studentId,draft.from_date,draft.to_date).first();
 const assignments=await env.DB.prepare(`SELECT COUNT(*) AS assigned,COUNT(t.id) AS submitted,AVG(t.estimated_band) AS average_band FROM assignments a
 LEFT JOIN attempts t ON t.id=(SELECT x.id FROM attempts x WHERE x.assignment_id=a.id AND x.user_id=? AND x.status IN ('SUBMITTED','EXPIRED') AND x.submitted_at<date(?,'+1 day') ORDER BY x.submitted_at DESC,x.id DESC LIMIT 1)
 WHERE a.classroom_id=? AND a.status IN ('ACTIVE','CLOSED') AND a.deadline_at>=? AND a.deadline_at<date(?,'+1 day')`).bind(studentId,draft.to_date,classId,draft.from_date,draft.to_date).first();
 const summary=JSON.stringify({attendance,assignments});const id=newId('trp'),now=nowIso(),notificationId=newId('ntf',16);
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO class_term_report_releases(id,classroom_id,student_id,title,from_date,to_date,feedback,summary_json,approved_by,approved_at)
   SELECT ?,d.classroom_id,d.student_id,d.title,d.from_date,d.to_date,d.feedback,?,?,? FROM class_term_report_drafts d
   JOIN classrooms c ON c.id=d.classroom_id AND c.status='ACTIVE' JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=d.student_id AND m.role='STUDENT' AND m.status='ACTIVE'
   WHERE d.classroom_id=? AND d.student_id=? AND d.updated_at=? AND d.title=? AND d.from_date=? AND d.to_date=? AND d.feedback=? AND (c.teacher_id=? OR ?='ADMIN' OR EXISTS(SELECT 1 FROM classroom_members ct WHERE ct.classroom_id=c.id AND ct.user_id=? AND ct.role='CO_TEACHER' AND ct.status='ACTIVE'))`).bind(id,summary,user.id,now,classId,studentId,draft.updated_at,draft.title,draft.from_date,draft.to_date,draft.feedback,user.id,user.role,user.id),
  env.DB.prepare(`INSERT INTO notifications(id,user_id,kind,title,body,href,read_at,created_at) SELECT ?,student_id,'CLASS','Có báo cáo học tập mới','Giáo viên đã duyệt và chia sẻ báo cáo của bạn.',?,NULL,? FROM class_term_report_releases WHERE id=?`).bind(notificationId,`/classrooms/${encodeURIComponent(classId)}`,now,id),
 ]);
 if(!result[0]?.meta.changes)throw ApiError.conflict('Bản nháp hoặc quyền truy cập đã thay đổi. Hãy tải lại.');return {id};
}
export async function studentTermReports(env:Env,user:AuthUser,classId:string) {
 if(user.role!=='STUDENT')throw ApiError.forbidden();
 const member=await env.DB.prepare("SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE'").bind(classId,user.id).first();if(!member)throw ApiError.forbidden();
 return (await env.DB.prepare('SELECT id,title,from_date,to_date,feedback,summary_json,approved_at FROM class_term_report_releases WHERE classroom_id=? AND student_id=? ORDER BY approved_at DESC,id DESC LIMIT 50').bind(classId,user.id).all()).results;
}
