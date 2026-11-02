import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {nowIso} from '../lib/ids';import {assertClassroomChatAccess} from './classroom-message-search';
type Row={id:string;sender_id:string;body:string;created_at:string;attachment_url:string|null;attachment_name:string|null;display_name:string;reply_to:string|null};
export async function listUnreadMarks(env:Env,user:AuthUser,classId:string){
 await assertClassroomChatAccess(env,classId,user);
 const result=await env.DB.prepare(`SELECT m.id,m.sender_id,m.body,m.created_at,m.attachment_url,m.attachment_name,r.root_id AS reply_to,
 COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Học viên') AS display_name
 FROM classroom_unread_marks mark JOIN classroom_messages m ON m.id=mark.message_id AND m.classroom_id=mark.classroom_id
 JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=m.sender_id LEFT JOIN classroom_message_replies r ON r.message_id=m.id
 WHERE mark.user_id=? AND mark.classroom_id=? ORDER BY mark.marked_at DESC,m.id DESC LIMIT 100`).bind(user.id,classId).all<Row>();
 return result.results.map(row=>({id:row.id,senderId:row.sender_id,senderName:row.display_name,body:row.body,createdAt:row.created_at,attachmentUrl:row.attachment_url,attachmentName:row.attachment_name,replyTo:row.reply_to}));
}
export async function markUnread(env:Env,user:AuthUser,classId:string,messageId:string){
 await assertClassroomChatAccess(env,classId,user);
 const result=await env.DB.prepare(`INSERT INTO classroom_unread_marks(user_id,classroom_id,message_id,marked_at)
 SELECT ?,c.id,m.id,? FROM classrooms c JOIN classroom_messages m ON m.classroom_id=c.id AND m.id=?
 WHERE c.id=? AND (?='ADMIN' OR c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members cm WHERE cm.classroom_id=c.id AND cm.user_id=? AND cm.status='ACTIVE'))
 AND (SELECT COUNT(*) FROM classroom_unread_marks mark WHERE mark.user_id=? AND mark.classroom_id=c.id)<100
 ON CONFLICT(user_id,classroom_id,message_id) DO NOTHING`).bind(user.id,nowIso(),messageId,classId,user.role,user.id,user.id,user.id).run();
 if(!result.meta.changes){const row=await env.DB.prepare('SELECT 1 FROM classroom_unread_marks WHERE user_id=? AND classroom_id=? AND message_id=?').bind(user.id,classId,messageId).first();if(!row)throw ApiError.conflict('Tin nhắn không còn hợp lệ hoặc đã đánh dấu đủ 100 tin.');}
}
export async function unmarkUnread(env:Env,user:AuthUser,classId:string,messageId:string){
 await assertClassroomChatAccess(env,classId,user);const result=await env.DB.prepare('DELETE FROM classroom_unread_marks WHERE user_id=? AND classroom_id=? AND message_id=?').bind(user.id,classId,messageId).run();if(!result.meta.changes)throw ApiError.notFound('Tin chưa đọc không tồn tại.');
}
