import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
export async function searchTeacherWorkspace(env:Env,user:AuthUser,query:string){
  const term=query.trim().slice(0,100);if(term.length<2)return {students:[],assignments:[]};
  const pattern=`%${term.replace(/[\\%_]/g,'\\$&')}%`;
  const scope="(cl.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members ct WHERE ct.classroom_id=cl.id AND ct.user_id=? AND ct.role='CO_TEACHER' AND ct.status='ACTIVE'))";
  const students=await env.DB.prepare(`SELECT DISTINCT u.id,COALESCE(NULLIF(p.display_name,''),u.email) AS name,u.email FROM classrooms cl JOIN classroom_members m ON m.classroom_id=cl.id AND m.role='STUDENT' AND m.status='ACTIVE' JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' LEFT JOIN user_profiles p ON p.user_id=u.id WHERE cl.status='ACTIVE' AND ${scope} AND (u.email LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\') ORDER BY name LIMIT 10`).bind(user.id,user.id,pattern,pattern).all();
  const assignments=await env.DB.prepare(`SELECT a.id,a.title,cl.name AS classroom_name FROM assignments a JOIN classrooms cl ON cl.id=a.classroom_id WHERE cl.status='ACTIVE' AND ${scope} AND a.status IN ('ACTIVE','CLOSED') AND a.title LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 10`).bind(user.id,user.id,pattern).all();return {students:students.results,assignments:assignments.results};
}
