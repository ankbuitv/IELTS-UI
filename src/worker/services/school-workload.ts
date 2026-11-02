import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {requireSchoolOwner} from './school-service';
/** School owner sees staff-level aggregates, never student identities or work. */
export async function schoolWorkload(env:Env,user:AuthUser,schoolId:string){
 await requireSchoolOwner(env,user,schoolId);const start=new Date(),end=new Date(start.getTime()+7*86400000);const from=start.toISOString(),to=end.toISOString();
 const members=await env.DB.prepare(`SELECT sm.user_id,COALESCE(NULLIF(p.display_name,''),u.email) AS name,
 (SELECT COUNT(DISTINCT c.id) FROM school_classroom_links l JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' WHERE l.school_id=sm.school_id AND (c.teacher_id=sm.user_id OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=sm.user_id AND m.role='CO_TEACHER' AND m.status='ACTIVE'))) AS class_count,
 (SELECT COUNT(*) FROM classroom_teaching_events e JOIN school_classroom_links l ON l.classroom_id=e.classroom_id JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' WHERE l.school_id=sm.school_id AND e.teacher_id=sm.user_id AND e.starts_at>=? AND e.starts_at<?) AS event_count,
 (SELECT COALESCE(SUM(MAX(0,(julianday(e.ends_at)-julianday(e.starts_at))*24)),0) FROM classroom_teaching_events e JOIN school_classroom_links l ON l.classroom_id=e.classroom_id JOIN classrooms c ON c.id=l.classroom_id AND c.status='ACTIVE' WHERE l.school_id=sm.school_id AND e.teacher_id=sm.user_id AND e.starts_at>=? AND e.starts_at<?) AS scheduled_hours
 FROM school_members sm JOIN users u ON u.id=sm.user_id AND u.status='ACTIVE' LEFT JOIN user_profiles p ON p.user_id=u.id WHERE sm.school_id=? AND sm.status='ACTIVE' ORDER BY name,sm.user_id LIMIT 200`).bind(from,to,from,to,schoolId).all();return{from,to,members:members.results};
}
