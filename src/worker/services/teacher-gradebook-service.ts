import {assignmentEligible} from './assignment-audience';
import type {Env} from '../env';
import type {AuthUser} from '../lib/auth-types';
import {nowIso} from '../lib/ids';
import {requireClassroomAccess} from './teacher-service';

/** Teacher-only matrix; no student work or answer content is returned. */
export async function classroomGradebook(env:Env,user:AuthUser,classId:string) {
  await requireClassroomAccess(env,user,classId);
  const assignments=await env.DB.prepare(`SELECT id,title,deadline_at,status FROM assignments WHERE classroom_id=? AND status IN ('ACTIVE','CLOSED') ORDER BY created_at DESC,id DESC LIMIT 100`).bind(classId).all();
  const students=await env.DB.prepare(`SELECT m.user_id,u.email,p.display_name,
    (SELECT COUNT(*) FROM classroom_attendance at WHERE at.classroom_id=m.classroom_id AND at.student_id=m.user_id AND at.status='ABSENT' AND at.attendance_date>=date('now','-29 days') AND at.attendance_date<=date('now')) AS absences_30_days,
    (SELECT latest.estimated_band-(SELECT prev.estimated_band FROM attempts prev JOIN assignments pa ON pa.id=prev.assignment_id AND pa.classroom_id=m.classroom_id AND pa.status IN ('ACTIVE','CLOSED') WHERE prev.user_id=m.user_id AND prev.test_type=latest.test_type AND prev.status IN ('SUBMITTED','EXPIRED') AND prev.estimated_band IS NOT NULL AND (prev.submitted_at<latest.submitted_at OR (prev.submitted_at=latest.submitted_at AND prev.id<latest.id)) ORDER BY prev.submitted_at DESC,prev.id DESC LIMIT 1)
      FROM attempts latest JOIN assignments la ON la.id=latest.assignment_id AND la.classroom_id=m.classroom_id AND la.status IN ('ACTIVE','CLOSED') WHERE latest.user_id=m.user_id AND latest.status IN ('SUBMITTED','EXPIRED') AND latest.estimated_band IS NOT NULL AND latest.submitted_at IS NOT NULL ORDER BY latest.submitted_at DESC,latest.id DESC LIMIT 1) AS band_change
    FROM classroom_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=m.user_id
    WHERE m.classroom_id=? AND m.role='STUDENT' AND m.status='ACTIVE' ORDER BY COALESCE(p.display_name,u.email),m.user_id LIMIT 200`).bind(classId).all();
  const cells=await env.DB.prepare(`SELECT a.id AS assignment_id,m.user_id,t.status,t.estimated_band,t.raw_score,t.total_questions,t.submitted_at
    FROM (SELECT id,deadline_at FROM assignments WHERE classroom_id=? AND status IN ('ACTIVE','CLOSED') ORDER BY created_at DESC,id DESC LIMIT 100) a
    CROSS JOIN (SELECT cm.user_id FROM classroom_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN user_profiles p ON p.user_id=cm.user_id WHERE cm.classroom_id=? AND cm.role='STUDENT' AND cm.status='ACTIVE' ORDER BY COALESCE(p.display_name,u.email),cm.user_id LIMIT 200) m
    LEFT JOIN attempts t ON t.id=(SELECT t2.id FROM attempts t2 WHERE t2.assignment_id=a.id AND t2.user_id=m.user_id AND t2.status IN ('SUBMITTED','EXPIRED') ORDER BY t2.submitted_at DESC,t2.id DESC LIMIT 1)
    WHERE ${assignmentEligible('a','m.user_id')}`).bind(classId,classId).all();
  return {generatedAt:nowIso(),assignments:assignments.results,students:students.results,cells:cells.results,limits:{students:200,assignments:100}};
}
