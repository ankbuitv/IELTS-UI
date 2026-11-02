import type {Env} from '../env';import type {AuthUser} from '../lib/auth-types';import {ApiError} from '../lib/errors';import {newId} from '../lib/ids';import {assertClassroomChatAccess} from './classroom-message-search';
type Person={id:string;name:string;role:string};
const eligible=`u.status='ACTIVE' AND (u.id=c.teacher_id OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=u.id AND m.status='ACTIVE'))`;
export async function mentionable(env:Env,user:AuthUser,classroomId:string){
 await assertClassroomChatAccess(env,classroomId,user);
 const result=await env.DB.prepare(`SELECT u.id,COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Thành viên') AS name,
 CASE WHEN u.id=c.teacher_id THEN 'Giáo viên' ELSE 'Thành viên' END AS role
 FROM classrooms c JOIN users u ON ${eligible} LEFT JOIN user_profiles p ON p.user_id=u.id
 WHERE c.id=? AND u.id!=? ORDER BY name,u.id LIMIT 500`).bind(classroomId,user.id).all<Person>();return result.results;
}
export async function resolveMentionTargets(env:Env,user:AuthUser,classroomId:string,ids:string[]){
 if(ids.length>10||new Set(ids).size!==ids.length||ids.includes(user.id))throw ApiError.validation('Chọn tối đa 10 thành viên khác nhau, không gồm chính bạn.');
 if(!ids.length)return [];
 const result=await env.DB.prepare(`SELECT u.id,COALESCE(NULLIF(TRIM(p.display_name),''),NULLIF(TRIM(u.username),''),NULLIF(substr(u.email,1,instr(u.email,'@')-1),''),'Thành viên') AS name,
 CASE WHEN u.id=c.teacher_id THEN 'Giáo viên' ELSE 'Thành viên' END AS role
 FROM classrooms c JOIN users u ON ${eligible} LEFT JOIN user_profiles p ON p.user_id=u.id
 WHERE c.id=? AND u.id IN (SELECT value FROM json_each(?))`).bind(classroomId,JSON.stringify(ids)).all<Person>();
 if(result.results.length!==ids.length)throw ApiError.validation('Một thành viên không còn thuộc lớp.');
 return ids.map(id=>result.results.find(row=>row.id===id)!);
}
export function mentionStatements(env:Env,classroomId:string,messageId:string,people:Person[],timestamp:string){
 if(!people.length)return [];
 const ids=JSON.stringify(people.map(person=>person.id));
 const statements=[env.DB.prepare(`INSERT INTO classroom_mention_guards(message_id,expected_count,verified_count)
 SELECT ?,?,COUNT(*) FROM classrooms c JOIN users u ON ${eligible} WHERE c.id=? AND u.id IN (SELECT value FROM json_each(?))`)
 .bind(messageId,people.length,classroomId,ids)];
 for(const person of people){
  const notificationId=newId('ntf',16);
  statements.push(env.DB.prepare('INSERT INTO classroom_message_mentions(message_id,user_id,display_name) VALUES(?,?,?)').bind(messageId,person.id,person.name));
  statements.push(env.DB.prepare(`INSERT INTO notifications(id,user_id,kind,title,body,href,read_at,created_at)
  SELECT ?,u.id,'CLASS_MESSAGE','Bạn được đề cập trong lớp','Có tin nhắn nhắc đến bạn trong cuộc trò chuyện của lớp.',CASE WHEN u.role='ADMIN' OR (u.role='TEACHER' AND (c.teacher_id=u.id OR EXISTS(SELECT 1 FROM classroom_members cm WHERE cm.classroom_id=c.id AND cm.user_id=u.id AND cm.role='CO_TEACHER' AND cm.status='ACTIVE'))) THEN ? ELSE ? END,NULL,?
  FROM users u JOIN classrooms c ON c.id=? WHERE u.id=? AND NOT EXISTS(SELECT 1 FROM classroom_chat_mutes mute WHERE mute.user_id=u.id AND mute.classroom_id=c.id AND mute.muted_until>?)`).bind(notificationId,`/teacher/classrooms/${encodeURIComponent(classroomId)}?tab=conversation`,`/classrooms/${encodeURIComponent(classroomId)}`,timestamp,classroomId,person.id,timestamp));
 }
 return statements;
}
