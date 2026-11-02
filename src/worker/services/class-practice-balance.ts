import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {requireClassroomAccess} from './teacher-service';
import {assignmentEligible} from './assignment-audience';
function validDate(value:string){const d=new Date(`${value}T00:00:00.000Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;}
export async function classPracticeBalance(env:Env,user:AuthUser,classId:string,from:string,to:string){
 await requireClassroomAccess(env,user,classId);
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`)>365*86400000)throw ApiError.validation('Chọn khoảng ngày hợp lệ tối đa 366 ngày.');
 const end=new Date(Date.parse(`${to}T00:00:00Z`)+86400000).toISOString();const start=`${from}T00:00:00.000Z`;
 const where=`asg.classroom_id=? AND asg.status IN ('ACTIVE','CLOSED') AND a.status IN ('SUBMITTED','EXPIRED') AND EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=asg.classroom_id AND m.user_id=a.user_id AND m.role='STUDENT' AND m.status='ACTIVE') AND ${assignmentEligible('asg','a.user_id')}`;
 const rows=await env.DB.prepare(`SELECT x.skill,COUNT(DISTINCT x.attempt_id) AS count FROM (
 SELECT s.skill,a.id AS attempt_id FROM attempts a JOIN assignments asg ON asg.id=a.assignment_id JOIN attempt_skill_sessions s ON s.attempt_id=a.id WHERE ${where} AND s.status IN ('SUBMITTED','EXPIRED') AND s.submitted_at>=? AND s.submitted_at<?
 UNION ALL SELECT 'SPEAKING' AS skill,a.id AS attempt_id FROM attempts a JOIN assignments asg ON asg.id=a.assignment_id JOIN speaking_sessions sp ON sp.source_attempt_id=a.id AND sp.user_id=a.user_id WHERE ${where} AND sp.status IN ('SUBMITTED','MARKED') AND sp.created_at>=? AND sp.created_at<?
 ) x GROUP BY x.skill`).bind(classId,start,end,classId,start,end).all<{skill:string;count:number}>();
 return {from,to,counts:['LISTENING','READING','WRITING','SPEAKING'].map(skill=>({skill,count:rows.results.find(row=>row.skill===skill)?.count??0}))};
}
