import {assignmentEligible} from './assignment-audience';
import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
/** Count learners, not attempts. Results are limited to classrooms the teacher owns or co-teaches. */
export async function teacherProgress(env:Env,user:AuthUser) {
  if(!['TEACHER','ADMIN'].includes(user.role))throw ApiError.forbidden();
  return (await env.DB.prepare(`SELECT c.id AS classroom_id,c.name AS classroom_name,a.id AS assignment_id,a.title,a.status,a.deadline_at,
    (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id=c.id AND m.role='STUDENT' AND m.status='ACTIVE' AND ${assignmentEligible('a','m.user_id')}) AS assigned_count,
    (SELECT COUNT(DISTINCT m.user_id) FROM classroom_members m JOIN attempts t ON t.user_id=m.user_id AND t.assignment_id=a.id AND t.status IN ('SUBMITTED','EXPIRED') WHERE m.classroom_id=c.id AND m.role='STUDENT' AND m.status='ACTIVE' AND ${assignmentEligible('a','m.user_id')}) AS submitted_count,
    (SELECT AVG(t.estimated_band) FROM attempts t JOIN classroom_members m ON m.user_id=t.user_id AND m.classroom_id=c.id AND m.role='STUDENT' AND m.status='ACTIVE' WHERE t.assignment_id=a.id AND ${assignmentEligible('a','m.user_id')} AND t.status IN ('SUBMITTED','EXPIRED') AND t.estimated_band IS NOT NULL AND t.id=(SELECT t2.id FROM attempts t2 WHERE t2.assignment_id=a.id AND t2.user_id=t.user_id AND t2.status IN ('SUBMITTED','EXPIRED') AND t2.estimated_band IS NOT NULL ORDER BY t2.submitted_at DESC,t2.id DESC LIMIT 1)) AS average_band
    FROM classrooms c JOIN assignments a ON a.classroom_id=c.id AND a.status IN ('ACTIVE','CLOSED')
    WHERE c.status='ACTIVE' AND (c.teacher_id=? OR EXISTS (SELECT 1 FROM classroom_members ct WHERE ct.classroom_id=c.id AND ct.user_id=? AND ct.role='CO_TEACHER' AND ct.status='ACTIVE'))
    ORDER BY c.name,a.created_at DESC`).bind(user.id,user.id).all()).results;
}
