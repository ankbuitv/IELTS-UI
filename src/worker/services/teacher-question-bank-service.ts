import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId,nowIso } from '../lib/ids';
export type QuestionInput={skill:'LISTENING'|'READING'|'WRITING'|'SPEAKING';topic:string;question:string;referenceAnswer:string;difficulty?:'UNSPECIFIED'|'EASY'|'MEDIUM'|'HARD';questionType?:'TEXT'|'MULTIPLE_CHOICE';options?:string[];correctIndex?:number|null;contextText?:string};
export async function listQuestions(env:Env,user:AuthUser) {
 return (await env.DB.prepare(`SELECT id,skill,topic,question,reference_answer,difficulty,question_type,options_json,correct_index,context_text,updated_at,EXISTS(SELECT 1 FROM teacher_question_media m WHERE m.question_id=teacher_question_bank.id AND m.kind='IMAGE') AS has_image,EXISTS(SELECT 1 FROM teacher_question_media m WHERE m.question_id=teacher_question_bank.id AND m.kind='AUDIO') AS has_audio FROM teacher_question_bank WHERE author_id=? ORDER BY updated_at DESC,id DESC LIMIT 500`).bind(user.id).all()).results;
}
export async function createQuestion(env:Env,user:AuthUser,input:QuestionInput) {
 const id=newId('tq'),now=nowIso();const result=await env.DB.prepare(`INSERT INTO teacher_question_bank(id,author_id,skill,topic,question,reference_answer,difficulty,question_type,options_json,correct_index,context_text,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM teacher_question_bank WHERE author_id=?)<500`).bind(id,user.id,input.skill,input.topic,input.question,input.referenceAnswer,input.difficulty??'UNSPECIFIED',input.questionType??'TEXT',JSON.stringify(input.options??[]),input.correctIndex??null,input.contextText??'',now,now,user.id).run();if(!result.meta.changes)throw ApiError.conflict('Ngân hàng tối đa 500 câu hỏi.');return id;
}
export async function updateQuestion(env:Env,user:AuthUser,id:string,input:QuestionInput) {
 const result=await env.DB.prepare('UPDATE teacher_question_bank SET skill=?,topic=?,question=?,reference_answer=?,difficulty=COALESCE(?,difficulty),question_type=?,options_json=?,correct_index=?,context_text=?,updated_at=? WHERE id=? AND author_id=?').bind(input.skill,input.topic,input.question,input.referenceAnswer,input.difficulty??null,input.questionType??'TEXT',JSON.stringify(input.options??[]),input.correctIndex??null,input.contextText??'',nowIso(),id,user.id).run();if(!result.meta.changes)throw ApiError.notFound();
}
export async function deleteQuestion(env:Env,user:AuthUser,id:string) {
 const result=await env.DB.prepare('DELETE FROM teacher_question_bank WHERE id=? AND author_id=?').bind(id,user.id).run();if(!result.meta.changes)throw ApiError.notFound();
}
