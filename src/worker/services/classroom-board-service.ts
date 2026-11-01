import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { requireClassroomAccess } from './teacher-service';

async function access(env:Env,user:AuthUser,classId:string) {
 if(user.role==='TEACHER'||user.role==='ADMIN') {
  const classroom=await requireClassroomAccess(env,user,classId);
  return {teacher:true,status:classroom.status};
 }
 if(user.role!=='STUDENT')throw ApiError.forbidden();
 const row=await env.DB.prepare(`SELECT c.status FROM classrooms c JOIN classroom_members m ON m.classroom_id=c.id
 WHERE c.id=? AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE'`).bind(classId,user.id).first<{status:string}>();
 if(!row)throw ApiError.forbidden('Bạn không phải học viên đang tham gia lớp này.');
 return {teacher:false,status:row.status};
}
async function writableTeacher(env:Env,user:AuthUser,classId:string) {
 const a=await access(env,user,classId);
 if(!a.teacher)throw ApiError.forbidden('Chỉ giáo viên được quản lý bảng lớp.');
 if(a.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ; bảng lớp chỉ đọc.');
}
export async function listClassroomBoard(env:Env,user:AuthUser,classId:string) {
 const a=await access(env,user,classId);
 const announcements=await env.DB.prepare(`SELECT a.id,a.title,a.body,a.pinned,a.created_at,COALESCE(p.display_name,u.email) AS author_name,
 (SELECT COUNT(*) FROM classroom_announcement_reads r JOIN classroom_members m ON m.user_id=r.student_id AND m.classroom_id=a.classroom_id AND m.status='ACTIVE' AND m.role='STUDENT' WHERE r.announcement_id=a.id) AS read_count,
 EXISTS(SELECT 1 FROM classroom_announcement_reads r WHERE r.announcement_id=a.id AND r.student_id=?) AS is_read
 FROM classroom_announcements a JOIN users u ON u.id=a.author_id LEFT JOIN user_profiles p ON p.user_id=u.id
 WHERE a.classroom_id=? ORDER BY a.pinned DESC,a.created_at DESC,a.id DESC LIMIT 100`).bind(user.id,classId).all<{id:string;title:string;body:string;pinned:number;created_at:string;author_name:string;read_count:number;is_read:number}>();
 const polls=await env.DB.prepare(`SELECT id,question,choices_json,status,created_at FROM classroom_polls WHERE classroom_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).bind(classId).all<{id:string;question:string;choices_json:string;status:string;created_at:string}>();
 const votes=await env.DB.prepare(`SELECT v.poll_id,v.choice_index,COUNT(*) AS count FROM classroom_poll_votes v JOIN classroom_polls p ON p.id=v.poll_id
 JOIN classroom_members m ON m.classroom_id=p.classroom_id AND m.user_id=v.student_id AND m.role='STUDENT' AND m.status='ACTIVE'
 WHERE p.id IN (SELECT id FROM classroom_polls WHERE classroom_id=? ORDER BY created_at DESC,id DESC LIMIT 100) GROUP BY v.poll_id,v.choice_index`).bind(classId).all<{poll_id:string;choice_index:number;count:number}>();
 const myVotes=await env.DB.prepare(`SELECT v.poll_id,v.choice_index FROM classroom_poll_votes v JOIN classroom_polls p ON p.id=v.poll_id WHERE p.classroom_id=? AND v.student_id=?`).bind(classId,user.id).all<{poll_id:string;choice_index:number}>();
 return {teacher:a.teacher,classroomStatus:a.status,announcements:announcements.results.map(x=>({id:x.id,title:x.title,body:x.body,pinned:!!x.pinned,createdAt:x.created_at,authorName:x.author_name,isRead:!!x.is_read,...(a.teacher?{readCount:x.read_count}:{})})),polls:polls.results.map(p=>{const choices=JSON.parse(p.choices_json) as string[];return{id:p.id,question:p.question,status:p.status,createdAt:p.created_at,choices:choices.map((text,index)=>({text,count:votes.results.find(v=>v.poll_id===p.id&&v.choice_index===index)?.count??0})),myVote:myVotes.results.find(v=>v.poll_id===p.id)?.choice_index??null};})};
}
export async function createAnnouncement(env:Env,user:AuthUser,classId:string,title:string,body:string) {
 await writableTeacher(env,user,classId);
 const id=newId('ann');await env.DB.prepare('INSERT INTO classroom_announcements(id,classroom_id,author_id,title,body,created_at) VALUES(?,?,?,?,?,?)').bind(id,classId,user.id,title,body,nowIso()).run();return id;
}
export async function pinAnnouncement(env:Env,user:AuthUser,classId:string,id:string,pinned:boolean) {
 await writableTeacher(env,user,classId);
 const result=await env.DB.prepare('UPDATE classroom_announcements SET pinned=? WHERE id=? AND classroom_id=?').bind(pinned?1:0,id,classId).run();
 if(!result.meta.changes)throw ApiError.notFound();
}
export async function deleteAnnouncement(env:Env,user:AuthUser,classId:string,id:string) {
 await writableTeacher(env,user,classId);
 const result=await env.DB.batch([env.DB.prepare('DELETE FROM classroom_announcement_reads WHERE announcement_id IN (SELECT id FROM classroom_announcements WHERE id=? AND classroom_id=?)').bind(id,classId),env.DB.prepare('DELETE FROM classroom_announcements WHERE id=? AND classroom_id=?').bind(id,classId)]);
 if(!result[1]?.meta.changes)throw ApiError.notFound();
}
export async function readAnnouncement(env:Env,user:AuthUser,classId:string,id:string) {
 const a=await access(env,user,classId);if(a.teacher)throw ApiError.forbidden();
 if(a.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ.');
 const result=await env.DB.prepare(`INSERT INTO classroom_announcement_reads(announcement_id,student_id,read_at)
 SELECT a.id,?,? FROM classroom_announcements a JOIN classrooms c ON c.id=a.classroom_id JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE' WHERE a.id=? AND a.classroom_id=? AND c.status='ACTIVE' ON CONFLICT(announcement_id,student_id) DO NOTHING`).bind(user.id,nowIso(),user.id,id,classId).run();
 if(!result.meta.changes){const exists=await env.DB.prepare(`SELECT 1 AS ok FROM classroom_announcement_reads r JOIN classroom_announcements a ON a.id=r.announcement_id JOIN classrooms c ON c.id=a.classroom_id JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=r.student_id AND m.role='STUDENT' AND m.status='ACTIVE' WHERE a.id=? AND a.classroom_id=? AND r.student_id=? AND c.status='ACTIVE'`).bind(id,classId,user.id).first();if(!exists)throw ApiError.conflict('Thông báo không còn khả dụng hoặc bạn không còn thuộc lớp.');}
}
export async function createPoll(env:Env,user:AuthUser,classId:string,question:string,choices:string[]) {
 await writableTeacher(env,user,classId);
 if(new Set(choices.map(x=>x.toLocaleLowerCase())).size!==choices.length)throw ApiError.validation('Các lựa chọn không được trùng nhau.');
 const id=newId('poll');await env.DB.prepare("INSERT INTO classroom_polls(id,classroom_id,author_id,question,choices_json,status,created_at) VALUES(?,?,?,?,?,'OPEN',?)").bind(id,classId,user.id,question,JSON.stringify(choices),nowIso()).run();return id;
}
export async function closePoll(env:Env,user:AuthUser,classId:string,id:string) {
 await writableTeacher(env,user,classId);const result=await env.DB.prepare("UPDATE classroom_polls SET status='CLOSED' WHERE id=? AND classroom_id=? AND status='OPEN'").bind(id,classId).run();if(!result.meta.changes)throw ApiError.conflict('Bình chọn không tồn tại hoặc đã đóng.');
}
export async function votePoll(env:Env,user:AuthUser,classId:string,id:string,choice:number) {
 const a=await access(env,user,classId);if(a.teacher)throw ApiError.forbidden('Chỉ học viên được bình chọn.');if(a.status!=='ACTIVE')throw ApiError.conflict('Lớp đã lưu trữ.');
 const poll=await env.DB.prepare('SELECT choices_json FROM classroom_polls WHERE id=? AND classroom_id=?').bind(id,classId).first<{choices_json:string}>();
 if(!poll)throw ApiError.notFound();const choices=JSON.parse(poll.choices_json) as string[];if(!Number.isInteger(choice)||choice<0||choice>=choices.length)throw ApiError.validation('Lựa chọn không hợp lệ.');
 const result=await env.DB.prepare(`INSERT INTO classroom_poll_votes(poll_id,student_id,choice_index,updated_at)
 SELECT p.id,?,?,? FROM classroom_polls p JOIN classrooms c ON c.id=p.classroom_id JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE'
 WHERE p.id=? AND p.classroom_id=? AND p.status='OPEN' AND c.status='ACTIVE'
 ON CONFLICT(poll_id,student_id) DO UPDATE SET choice_index=excluded.choice_index,updated_at=excluded.updated_at`).bind(user.id,choice,nowIso(),user.id,id,classId).run();
 if(!result.meta.changes)throw ApiError.conflict('Bình chọn đã đóng hoặc bạn không còn thuộc lớp.');
}
