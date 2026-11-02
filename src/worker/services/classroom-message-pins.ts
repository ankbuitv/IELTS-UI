import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {ApiError} from '../lib/errors';
import {nowIso} from '../lib/ids';
import {requireClassroomAccess} from './teacher-service';
import {assertClassroomChatAccess} from './classroom-message-search';
type Row={id:string;sender_id:string;body:string;created_at:string;attachment_url:string|null;attachment_name:string|null;display_name:string;pinned_at:string};
export async function listMessagePins(env:Env,user:AuthUser,classroomId:string){
 await assertClassroomChatAccess(env,classroomId,user);
 const classroom=await env.DB.prepare('SELECT teacher_id,status FROM classrooms WHERE id=?').bind(classroomId).first<{teacher_id:string;status:string}>();
 const co=classroom?.teacher_id!==user.id&&user.role==='TEACHER'?await env.DB.prepare("SELECT 1 FROM classroom_members WHERE classroom_id=? AND user_id=? AND role='CO_TEACHER' AND status='ACTIVE'").bind(classroomId,user.id).first():null;
 const canManage=classroom?.status==='ACTIVE'&&(user.role==='ADMIN'||(user.role==='TEACHER'&&(classroom.teacher_id===user.id||!!co)));
 const rows=await env.DB.prepare(`SELECT m.id,m.sender_id,m.body,m.created_at,m.attachment_url,m.attachment_name,pin.created_at AS pinned_at,
 COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Học viên') AS display_name
 FROM classroom_message_pins pin JOIN classroom_messages m ON m.id=pin.message_id AND m.classroom_id=pin.classroom_id
 JOIN users u ON u.id=m.sender_id LEFT JOIN user_profiles p ON p.user_id=m.sender_id
 WHERE pin.classroom_id=? ORDER BY pin.created_at DESC,m.id DESC LIMIT 20`).bind(classroomId).all<Row>();
 return {canManage,messages:rows.results.map(row=>({id:row.id,senderId:row.sender_id,senderName:row.display_name,body:row.body,createdAt:row.created_at,attachmentUrl:row.attachment_url,attachmentName:row.attachment_name,pinnedAt:row.pinned_at}))};
}
async function assertManager(env:Env,user:AuthUser,classroomId:string){
 if(user.role!=='TEACHER'&&user.role!=='ADMIN')throw ApiError.forbidden();
 const klass=await requireClassroomAccess(env,user,classroomId);if(klass.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ.');
}
export async function pinMessage(env:Env,user:AuthUser,classroomId:string,messageId:string){
 await assertManager(env,user,classroomId);
 const result=await env.DB.prepare(`INSERT INTO classroom_message_pins(classroom_id,message_id,pinned_by,created_at)
 SELECT c.id,m.id,?,? FROM classrooms c JOIN classroom_messages m ON m.classroom_id=c.id AND m.id=?
 WHERE c.id=? AND c.status='ACTIVE' AND (?='ADMIN' OR c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members cm WHERE cm.classroom_id=c.id AND cm.user_id=? AND cm.role='CO_TEACHER' AND cm.status='ACTIVE'))
 AND (SELECT COUNT(*) FROM classroom_message_pins p WHERE p.classroom_id=c.id)<20 ON CONFLICT(classroom_id,message_id) DO NOTHING`).bind(user.id,nowIso(),messageId,classroomId,user.role,user.id,user.id).run();
 if(!result.meta.changes){const pinned=await env.DB.prepare('SELECT 1 FROM classroom_message_pins WHERE classroom_id=? AND message_id=?').bind(classroomId,messageId).first();if(!pinned)throw ApiError.conflict('Tin nhắn không còn hợp lệ hoặc lớp đã ghim đủ 20 tin.');}
}
export async function unpinMessage(env:Env,user:AuthUser,classroomId:string,messageId:string){
 await assertManager(env,user,classroomId);
 const result=await env.DB.prepare(`DELETE FROM classroom_message_pins WHERE classroom_id=? AND message_id=? AND EXISTS(SELECT 1 FROM classrooms c WHERE c.id=classroom_message_pins.classroom_id AND c.status='ACTIVE' AND (?='ADMIN' OR c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members cm WHERE cm.classroom_id=c.id AND cm.user_id=? AND cm.role='CO_TEACHER' AND cm.status='ACTIVE')))`)
 .bind(classroomId,messageId,user.role,user.id,user.id).run();if(!result.meta.changes)throw ApiError.notFound('Tin ghim không tồn tại hoặc không còn quyền.');
}
