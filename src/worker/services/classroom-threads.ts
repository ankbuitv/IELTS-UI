import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {assertClassroomChatAccess} from './classroom-message-search';
type Row={id:string;sender_id:string;body:string;created_at:string;attachment_url:string|null;attachment_name:string|null;display_name:string};
const projection=`m.id,m.sender_id,m.body,m.created_at,m.attachment_url,m.attachment_name,COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Học viên') AS display_name`;
const view=(r:Row)=>({id:r.id,senderId:r.sender_id,senderName:r.display_name,body:r.body,createdAt:r.created_at,attachmentUrl:r.attachment_url,attachmentName:r.attachment_name});
export async function assertThreadRoot(env:Env,classroomId:string,rootId:string){
 const root=await env.DB.prepare(`SELECT 1 FROM classroom_messages m WHERE m.id=? AND m.classroom_id=? AND NOT EXISTS(SELECT 1 FROM classroom_message_replies r WHERE r.message_id=m.id)`).bind(rootId,classroomId).first();
 if(!root)throw ApiError.notFound('Tin nhắn gốc không tồn tại trong lớp.');
}
export async function listThread(env:Env,user:AuthUser,classroomId:string,rootId:string){
 await assertClassroomChatAccess(env,classroomId,user);await assertThreadRoot(env,classroomId,rootId);
 const root=await env.DB.prepare(`SELECT ${projection} FROM classroom_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=m.sender_id WHERE m.id=? AND m.classroom_id=?`).bind(rootId,classroomId).first<Row>();
 if(!root)throw ApiError.notFound();
 const result=await env.DB.prepare(`SELECT ${projection} FROM classroom_message_replies r JOIN classroom_messages m ON m.id=r.message_id AND m.classroom_id=r.classroom_id JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=m.sender_id WHERE r.classroom_id=? AND r.root_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`).bind(classroomId,rootId).all<Row>();
 return {root:view(root),messages:result.results.map(view).reverse()};
}
