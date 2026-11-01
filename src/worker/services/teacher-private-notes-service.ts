import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { requireClassroomAccess } from './teacher-service';

/** Notes are private to their author even when another teacher or admin can access the class. */
export async function listPrivateNotes(env: Env, user: AuthUser, classroomId: string) {
  const classroom = await requireClassroomAccess(env, user, classroomId);
  const result = await env.DB.prepare(`SELECT m.user_id,u.email,p.display_name,n.body,n.updated_at
    FROM classroom_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN user_profiles p ON p.user_id=m.user_id
    LEFT JOIN teacher_private_notes n ON n.classroom_id=m.classroom_id AND n.student_id=m.user_id AND n.author_id=?
    WHERE m.classroom_id=? AND m.role='STUDENT' AND m.status='ACTIVE'
    ORDER BY COALESCE(p.display_name,u.email) LIMIT 500`).bind(user.id,classroomId).all();
  return { classroomStatus: classroom.status, students: result.results };
}
export async function savePrivateNote(env: Env, user: AuthUser, classroomId: string, studentId: string, body: string) {
  const classroom = await requireClassroomAccess(env, user, classroomId);
  if (classroom.status !== 'ACTIVE') throw ApiError.conflict('Lớp đã lưu trữ; chỉ có thể xem ghi chú.');
  if (body.length > 4000) throw ApiError.validation('Ghi chú tối đa 4000 ký tự.');
  const member = await env.DB.prepare("SELECT 1 AS ok FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE'").bind(classroomId,studentId).first();
  if (!member) throw ApiError.notFound('Không tìm thấy học viên đang tham gia lớp.');
  if (!body.trim()) {
    await env.DB.prepare('DELETE FROM teacher_private_notes WHERE classroom_id=? AND student_id=? AND author_id=?').bind(classroomId,studentId,user.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO teacher_private_notes(classroom_id,student_id,author_id,body,updated_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='STUDENT' AND status='ACTIVE')
      ON CONFLICT(classroom_id,student_id,author_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`).bind(classroomId,studentId,user.id,body,nowIso(),classroomId,studentId).run();
  }
}
