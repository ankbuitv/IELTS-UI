import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
export async function assertClassroomChatAccess(env:Env,classroomId:string,user:AuthUser){
 if(user.role==='ADMIN'){const row=await env.DB.prepare('SELECT id FROM classrooms WHERE id=?').bind(classroomId).first();if(!row)throw ApiError.notFound('That classroom does not exist.');return;}
 const member=await env.DB.prepare(`SELECT 1 AS ok FROM classroom_members WHERE classroom_id=? AND user_id=? AND status='ACTIVE'
 UNION SELECT 1 AS ok FROM classrooms WHERE id=? AND teacher_id=? LIMIT 1`).bind(classroomId,user.id,classroomId,user.id).first();
 if(!member)throw ApiError.forbidden('Join this classroom to see its chat.');
}
type Row={id:string;sender_id:string;body:string;created_at:string;attachment_url:string|null;attachment_name:string|null;display_name:string;reply_to:string|null};
export async function searchClassroomMessages(env:Env,user:AuthUser,classroomId:string,query:string,cursor?:{time:string;id:string}){
 const term=query.trim();if(term.length<2||term.length>100)throw ApiError.validation('Nhập từ 2 đến 100 ký tự để tìm kiếm.');
 if(cursor&&(!cursor.time||cursor.time.length>100||!cursor.id||cursor.id.length>100))throw ApiError.validation('Vị trí tìm kiếm không hợp lệ.');
 await assertClassroomChatAccess(env,classroomId,user);
 const result=await env.DB.prepare(`SELECT m.id,m.sender_id,m.body,m.created_at,m.attachment_url,m.attachment_name,(SELECT root_id FROM classroom_message_replies reply WHERE reply.message_id=m.id) AS reply_to,
 COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Học viên') AS display_name
 FROM classroom_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=m.sender_id
 WHERE m.classroom_id=? AND (instr(lower(m.body),lower(?))>0 OR instr(lower(COALESCE(m.attachment_name,'')),lower(?))>0)
 AND (? IS NULL OR m.created_at<? OR (m.created_at=? AND m.id<?))
 ORDER BY m.created_at DESC,m.id DESC LIMIT 31`).bind(classroomId,term,term,cursor?.time??null,cursor?.time??null,cursor?.time??null,cursor?.id??null).all<Row>();
 const page=result.results.slice(0,30),last=page[page.length-1];return {messages:page.map(row=>({id:row.id,senderId:row.sender_id,senderName:row.display_name,body:row.body,createdAt:row.created_at,attachmentUrl:row.attachment_url,attachmentName:row.attachment_name,replyTo:row.reply_to})),next:result.results.length>30&&last?{time:last.created_at,id:last.id}:null};
}
