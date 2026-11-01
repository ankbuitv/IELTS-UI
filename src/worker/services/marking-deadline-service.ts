import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {nowIso} from '../lib/ids';import {requireClassroomAccess} from './teacher-service';
export async function setMarkingDeadline(env:Env,user:AuthUser,assignmentId:string,deadline:string|null){
 const assignment=await env.DB.prepare('SELECT classroom_id FROM assignments WHERE id=?').bind(assignmentId).first<{classroom_id:string}>();if(!assignment)throw ApiError.notFound();
 const klass=await requireClassroomAccess(env,user,assignment.classroom_id);if(klass.status!=='ACTIVE')throw ApiError.conflict('Archived classrooms are read-only.');
 if(deadline===null){await env.DB.prepare('DELETE FROM assignment_marking_deadlines WHERE assignment_id=?').bind(assignmentId).run();return;}
 await env.DB.prepare(`INSERT INTO assignment_marking_deadlines(assignment_id,deadline_at,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(assignment_id) DO UPDATE SET deadline_at=excluded.deadline_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(assignmentId,deadline,user.id,nowIso()).run();
}
