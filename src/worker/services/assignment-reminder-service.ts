import {assignmentEligible} from './assignment-audience';
import type {Env} from '../env';
import {newId} from '../lib/ids';
/** Once per student and deadline, with notification creation in the same D1 batch. */
export async function sendAssignmentReminders(env:Env,now=new Date()) {
 const from=now.toISOString(),to=new Date(now.getTime()+24*60*60*1000).toISOString();
 const candidates=await env.DB.prepare(`SELECT a.id AS assignment_id,a.classroom_id,a.title,a.deadline_at,m.user_id
 FROM assignments a JOIN classrooms c ON c.id=a.classroom_id AND c.status='ACTIVE'
 JOIN classroom_members m ON m.classroom_id=c.id AND m.role='STUDENT' AND m.status='ACTIVE'
 JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
 WHERE a.status='ACTIVE' AND ${assignmentEligible('a','m.user_id')} AND a.deadline_at>? AND a.deadline_at<=?
 AND NOT EXISTS(SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=m.user_id AND t.status IN ('SUBMITTED','EXPIRED'))
 AND NOT EXISTS(SELECT 1 FROM assignment_reminders r WHERE r.assignment_id=a.id AND r.student_id=m.user_id AND r.deadline_at=a.deadline_at)
 ORDER BY a.deadline_at,a.id,m.user_id LIMIT 500`).bind(from,to).all<{assignment_id:string;classroom_id:string;title:string;deadline_at:string;user_id:string}>();
 let sent=0;
 for(const row of candidates.results) {
  const id=newId('ntf',16);
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO assignment_reminders(assignment_id,student_id,deadline_at,notification_id,created_at)
    SELECT a.id,m.user_id,a.deadline_at,?,? FROM assignments a JOIN classrooms c ON c.id=a.classroom_id AND c.status='ACTIVE'
    JOIN classroom_members m ON m.classroom_id=c.id AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE'
    JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
    WHERE a.id=? AND a.status='ACTIVE' AND ${assignmentEligible('a','m.user_id')} AND a.deadline_at=? AND a.deadline_at>? AND a.deadline_at<=?
    AND NOT EXISTS(SELECT 1 FROM attempts t WHERE t.assignment_id=a.id AND t.user_id=m.user_id AND t.status IN ('SUBMITTED','EXPIRED'))
    ON CONFLICT(assignment_id,student_id,deadline_at) DO NOTHING`).bind(id,from,row.user_id,row.assignment_id,row.deadline_at,from,to),
   env.DB.prepare(`INSERT INTO notifications(id,user_id,kind,title,body,href,read_at,created_at)
    SELECT notification_id,student_id,'ASSIGNMENT',?,?,?,NULL,? FROM assignment_reminders WHERE notification_id=?`).bind('Bài tập sắp đến hạn',`“${row.title}” sẽ đến hạn trong 24 giờ. Hãy kiểm tra thời hạn trong lớp.`,`/classrooms/${encodeURIComponent(row.classroom_id)}`,from,id),
  ]);
  sent+=Number(result[0]?.meta.changes??0);
 }
 return sent;
}
