import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {requireClassroomAccess} from './teacher-service';

/** Only work assigned in this class, never the learner's unrelated/private attempts. */
export async function classStudentProgress(env:Env,user:AuthUser,classId:string,studentId:string) {
 await requireClassroomAccess(env,user,classId);
 const student=await env.DB.prepare(`SELECT u.id,u.email,p.display_name,p.target_band FROM classroom_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
 WHERE m.classroom_id=? AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE'`).bind(classId,studentId).first();
 if(!student)throw ApiError.notFound('Không tìm thấy học viên đang tham gia lớp.');
 const points=await env.DB.prepare(`SELECT q.* FROM (
   SELECT s.skill,s.estimated_band AS band,a.submitted_at AS date,asg.title AS assignment_title
   FROM attempts a JOIN assignments asg ON asg.id=a.assignment_id JOIN attempt_skill_sessions s ON s.attempt_id=a.id
   WHERE asg.classroom_id=? AND asg.status IN ('ACTIVE','CLOSED') AND a.user_id=? AND a.status IN ('SUBMITTED','EXPIRED') AND s.status IN ('SUBMITTED','EXPIRED') AND s.estimated_band IS NOT NULL AND a.submitted_at IS NOT NULL
   UNION ALL
   SELECT 'SPEAKING' AS skill,s.overall_band AS band,COALESCE(s.scored_at,s.marked_at,s.updated_at) AS date,asg.title AS assignment_title
   FROM speaking_sessions s JOIN attempts a ON a.id=s.source_attempt_id JOIN assignments asg ON asg.id=a.assignment_id
   WHERE asg.classroom_id=? AND asg.status IN ('ACTIVE','CLOSED') AND a.user_id=? AND a.status IN ('SUBMITTED','EXPIRED') AND s.user_id=a.user_id AND s.status='MARKED' AND s.overall_band IS NOT NULL
 ) q ORDER BY q.date DESC LIMIT 200`).bind(classId,studentId,classId,studentId).all();
 return {student,points:points.results};
}
