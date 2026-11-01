import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId,nowIso } from '../lib/ids';

export async function listFeedbackTemplates(env:Env,user:AuthUser) {
 return (await env.DB.prepare('SELECT id,title,body FROM teacher_feedback_templates WHERE author_id=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(user.id).all()).results;
}
export async function createFeedbackTemplate(env:Env,user:AuthUser,title:string,body:string) {
 const id=newId('ft');const result=await env.DB.prepare(`INSERT INTO teacher_feedback_templates(id,author_id,title,body,created_at)
 SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM teacher_feedback_templates WHERE author_id=?)<50`).bind(id,user.id,title,body,nowIso(),user.id).run();
 if(!result.meta.changes)throw ApiError.conflict('Tối đa 50 mẫu nhận xét.');return id;
}
export async function deleteFeedbackTemplate(env:Env,user:AuthUser,id:string) {
 const result=await env.DB.prepare('DELETE FROM teacher_feedback_templates WHERE id=? AND author_id=?').bind(id,user.id).run();if(!result.meta.changes)throw ApiError.notFound();
}

export async function updateFeedbackTemplate(env:Env,user:AuthUser,id:string,title:string,body:string) {const result=await env.DB.prepare('UPDATE teacher_feedback_templates SET title=?,body=? WHERE id=? AND author_id=?').bind(title,body,id,user.id).run();if(!result.meta.changes)throw ApiError.notFound();}
