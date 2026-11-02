import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {requireClassroomAccess} from './teacher-service';
import {assignmentEligible} from './assignment-audience';
/** Marked answers to class assignments only; does not expose learners' answer contents. */
export async function classQuestionAnalysis(env:Env,user:AuthUser,classId:string){
 await requireClassroomAccess(env,user,classId);
 const rows=await env.DB.prepare(`SELECT a.id AS assignment_id,a.title AS assignment_title,q.id AS question_id,q.number,q.prompt,s.skill,
 COUNT(*) AS marked,SUM(CASE WHEN aa.is_correct=0 THEN 1 ELSE 0 END) AS wrong,
 COUNT(DISTINCT t.user_id) AS learners,COUNT(DISTINCT CASE WHEN aa.is_correct=0 THEN t.user_id END) AS learners_wrong
 FROM attempt_answers aa JOIN attempts t ON t.id=aa.attempt_id
 JOIN assignments a ON a.id=t.assignment_id JOIN questions q ON q.id=aa.question_id AND q.test_version_id=aa.test_version_id
 JOIN attempt_skill_sessions s ON s.id=aa.skill_session_id AND s.attempt_id=t.id
 WHERE a.classroom_id=? AND a.status IN ('ACTIVE','CLOSED') AND t.status IN ('SUBMITTED','EXPIRED')
 AND s.status IN ('SUBMITTED','EXPIRED') AND aa.is_correct IN (0,1)
 AND EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=a.classroom_id AND m.user_id=t.user_id AND m.role='STUDENT' AND m.status='ACTIVE')
 AND ${assignmentEligible('a','t.user_id')}
 GROUP BY a.id,q.id ORDER BY learners_wrong DESC,wrong DESC,marked DESC,a.id,q.number,q.id LIMIT 50`).bind(classId).all();
 return {questions:rows.results};
}
