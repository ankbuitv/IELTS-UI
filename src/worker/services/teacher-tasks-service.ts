import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { validAttendanceDate } from './teacher-attendance-service';

export type TaskPriority = 'HIGH' | 'NORMAL' | 'LOW';
type TaskInput = { title: string; dueDate: string | null; priority: TaskPriority; completed: boolean };
type TaskRow = { id:string;title:string;due_date:string|null;priority:TaskPriority;completed:number;completed_at:string|null;created_at:string;updated_at:string };
function validate(input:Partial<TaskInput>) {
  if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) throw ApiError.validation('Tên việc phải có từ 1 đến 200 ký tự.');
  if (input.dueDate != null && !validAttendanceDate(input.dueDate)) throw ApiError.validation('Ngày cần làm không hợp lệ.');
  if (input.priority !== undefined && !['HIGH','NORMAL','LOW'].includes(input.priority)) throw ApiError.validation('Mức ưu tiên không hợp lệ.');
}
export async function listTeacherTasks(env:Env,user:AuthUser) {
  const result=await env.DB.prepare(`SELECT id,title,due_date,priority,completed,completed_at,created_at,updated_at FROM teacher_tasks
    WHERE user_id=? ORDER BY completed ASC, CASE priority WHEN 'HIGH' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END, due_date IS NULL, due_date ASC, created_at DESC LIMIT 500`).bind(user.id).all<TaskRow>();
  return result.results.map(row=>({id:row.id,title:row.title,dueDate:row.due_date,priority:row.priority,completed:!!row.completed,completedAt:row.completed_at,createdAt:row.created_at,updatedAt:row.updated_at}));
}
export async function createTeacherTask(env:Env,user:AuthUser,input:Omit<TaskInput,'completed'>) {
  validate(input);const id=newId('task'),now=nowIso();
  const result=await env.DB.prepare(`INSERT INTO teacher_tasks(id,user_id,title,due_date,priority,created_at,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM teacher_tasks WHERE user_id=?) < 500`).bind(id,user.id,input.title.trim(),input.dueDate,input.priority,now,now,user.id).run();
  if (!result.meta.changes) throw ApiError.conflict('Tối đa 500 việc cá nhân; hãy xóa bớt việc cũ.');
  return id;
}
export async function updateTeacherTask(env:Env,user:AuthUser,id:string,input:Partial<TaskInput>) {
  validate(input);if(!Object.keys(input).length)throw ApiError.validation('Không có thay đổi.');
  const result=await env.DB.prepare(`UPDATE teacher_tasks SET title=COALESCE(?,title), due_date=CASE WHEN ?=1 THEN ? ELSE due_date END,
    priority=COALESCE(?,priority),
    completed_at=CASE WHEN ?=1 THEN CASE WHEN ?=1 THEN CASE WHEN completed=0 THEN ? ELSE completed_at END ELSE NULL END ELSE completed_at END,
    completed=COALESCE(?,completed), updated_at=? WHERE id=? AND user_id=?`)
    .bind(input.title?.trim()??null,input.dueDate!==undefined?1:0,input.dueDate??null,input.priority??null,input.completed===undefined?0:1,input.completed?1:0,nowIso(),input.completed===undefined?null:Number(input.completed),nowIso(),id,user.id).run();
  if(!result.meta.changes) throw ApiError.notFound();
}
export async function deleteTeacherTask(env:Env,user:AuthUser,id:string) {
  const result=await env.DB.prepare('DELETE FROM teacher_tasks WHERE id=? AND user_id=?').bind(id,user.id).run();
  if(!result.meta.changes) throw ApiError.notFound();
}

export async function readDailyNote(env:Env,user:AuthUser,day:string) {
 if(!validAttendanceDate(day))throw ApiError.validation('Ngày tổng kết không hợp lệ.');
 const row=await env.DB.prepare('SELECT body,updated_at FROM teacher_daily_notes WHERE user_id=? AND day=?').bind(user.id,day).first<{body:string;updated_at:string}>();
 return {body:row?.body??'',updatedAt:row?.updated_at??null};
}
export async function saveDailyNote(env:Env,user:AuthUser,day:string,body:string) {
 if(!validAttendanceDate(day)||body.length>4000)throw ApiError.validation('Ngày hoặc nội dung không hợp lệ.');
 if(!body.trim()){await env.DB.prepare('DELETE FROM teacher_daily_notes WHERE user_id=? AND day=?').bind(user.id,day).run();return;}
 await env.DB.prepare(`INSERT INTO teacher_daily_notes(user_id,day,body,updated_at) VALUES(?,?,?,?)
   ON CONFLICT(user_id,day) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at`).bind(user.id,day,body,nowIso()).run();
}
