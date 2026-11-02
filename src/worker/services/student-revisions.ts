import {resultDeadline} from './assignment-extensions';
import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {evaluateRelease} from './attempt-service';import type {ResultVisibility,TestType} from '../../shared/types';
type WritingRow={attempt_id:string;submission_id:string;title:string;class_name:string;version:number;reviewed_at:string;status:'SUBMITTED'|'EXPIRED';test_type:TestType;result_visibility:ResultVisibility;deadline_at:string|null};
/** Lists only returned latest versions that this student can actually revise. */
export async function studentRevisions(env:Env,user:AuthUser){
 if(user.role!=='STUDENT')throw ApiError.forbidden();
 const writing=await env.DB.prepare(`SELECT a.id AS attempt_id,w.id AS submission_id,asg.title,c.name AS class_name,v.version,v.reviewed_at,a.status,a.test_type,asg.result_visibility,${resultDeadline('asg')} AS deadline_at
 FROM writing_review_versions v JOIN writing_submissions w ON w.id=v.writing_submission_id JOIN attempts a ON a.id=w.attempt_id JOIN assignments asg ON asg.id=a.assignment_id JOIN classrooms c ON c.id=asg.classroom_id AND c.status='ACTIVE' JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=a.user_id AND m.role='STUDENT' AND m.status='ACTIVE'
 WHERE a.user_id=? AND a.status IN ('SUBMITTED','EXPIRED') AND asg.status IN ('ACTIVE','CLOSED') AND v.state='RETURNED' AND v.version<10 AND v.version=(SELECT MAX(v2.version) FROM writing_review_versions v2 WHERE v2.writing_submission_id=w.id)
 ORDER BY v.reviewed_at DESC,v.id DESC LIMIT 200`).bind(user.id).all<WritingRow>();
 const worksheets=await env.DB.prepare(`SELECT w.id AS worksheet_id,w.title,c.id AS class_id,c.name AS class_name,v.version,v.reviewed_at FROM class_worksheet_versions v JOIN class_worksheets w ON w.id=v.worksheet_id AND w.status='ACTIVE' JOIN classrooms c ON c.id=w.classroom_id AND c.status='ACTIVE' JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=v.student_id AND m.role='STUDENT' AND m.status='ACTIVE'
 WHERE v.student_id=? AND v.state='RETURNED' AND v.version<10 AND v.version=(SELECT MAX(v2.version) FROM class_worksheet_versions v2 WHERE v2.worksheet_id=w.id AND v2.student_id=v.student_id) ORDER BY v.reviewed_at DESC,v.id DESC LIMIT 100`).bind(user.id).all();
 return {writing:writing.results.filter(row=>evaluateRelease(row,{deadline_at:row.deadline_at,result_visibility:row.result_visibility}).reviewAvailable).slice(0,100).map(({attempt_id,submission_id,title,class_name,version,reviewed_at})=>({attempt_id,submission_id,title,class_name,version,reviewed_at})),worksheets:worksheets.results};
}
