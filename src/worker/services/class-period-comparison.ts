import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {requireClassroomAccess} from './teacher-service';
import {assignmentEligible} from './assignment-audience';
function bounds(from:string,to:string){
 const valid=(value:string)=>{const d=new Date(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;};
 if(!valid(from)||!valid(to)||from>to||Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`)>365*86400000)throw ApiError.validation('Mỗi khoảng phải hợp lệ và tối đa 366 ngày.');
 return [`${from}T00:00:00.000Z`,new Date(Date.parse(`${to}T00:00:00Z`)+86400000).toISOString()];
}
export async function classPeriodComparison(env:Env,user:AuthUser,classId:string,aFrom:string,aTo:string,bFrom:string,bTo:string){
 await requireClassroomAccess(env,user,classId);const a=bounds(aFrom,aTo),b=bounds(bFrom,bTo);
 const query=async(period:string[])=>{
  const row=await env.DB.prepare(`SELECT COUNT(*) AS assigned, SUM(CASE WHEN EXISTS(SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=m.user_id AND t.status IN ('SUBMITTED','EXPIRED')) THEN 1 ELSE 0 END) AS submitted FROM assignments a JOIN classroom_members m ON m.classroom_id=a.classroom_id AND m.role='STUDENT' AND m.status='ACTIVE' WHERE a.classroom_id=? AND a.status IN ('ACTIVE','CLOSED') AND a.created_at>=? AND a.created_at<? AND ${assignmentEligible('a','m.user_id')}`).bind(classId,...period).first<{assigned:number;submitted:number|null}>();return {assigned:row?.assigned??0,submitted:row?.submitted??0};
 };
 const [first,second]=await Promise.all([query(a),query(b)]);return {first:{from:aFrom,to:aTo,...first},second:{from:bFrom,to:bTo,...second}};
}
