import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {nowIso} from '../lib/ids';import {assertClassroomChatAccess} from './classroom-message-search';
export async function getClassChatMute(env:Env,user:AuthUser,classId:string){
 await assertClassroomChatAccess(env,classId,user);const row=await env.DB.prepare('SELECT muted_until FROM classroom_chat_mutes WHERE user_id=? AND classroom_id=?').bind(user.id,classId).first<{muted_until:string}>();const now=nowIso();return{mutedUntil:row&&row.muted_until>now?row.muted_until:null};
}
export async function setClassChatMute(env:Env,user:AuthUser,classId:string,minutes:number|null){
 await assertClassroomChatAccess(env,classId,user);
 if(minutes===null){await env.DB.prepare('DELETE FROM classroom_chat_mutes WHERE user_id=? AND classroom_id=?').bind(user.id,classId).run();return;}
 if(!Number.isInteger(minutes)||minutes<1||minutes>10080)throw ApiError.validation('Chọn thời gian từ 1 phút đến 7 ngày.');
 const now=nowIso(),until=new Date(Date.parse(now)+minutes*60000).toISOString();
 const result=await env.DB.prepare(`INSERT INTO classroom_chat_mutes(user_id,classroom_id,muted_until,updated_at)
 SELECT ?,c.id,?,? FROM classrooms c WHERE c.id=? AND (?='ADMIN' OR c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members cm WHERE cm.classroom_id=c.id AND cm.user_id=? AND cm.status='ACTIVE'))
 ON CONFLICT(user_id,classroom_id) DO UPDATE SET muted_until=excluded.muted_until,updated_at=excluded.updated_at`).bind(user.id,until,now,classId,user.role,user.id,user.id).run();
 if(!result.meta.changes)throw ApiError.forbidden('Bạn không còn thuộc lớp.');
}
