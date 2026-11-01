import {assignmentEligible} from '../services/assignment-audience';
/**
 * The four SQL queries behind `GET /api/student/calendar`, kept as plain
 * exported strings so a unit test can run them against the real runtime schema
 * (see tests/unit/calendar-queries.test.ts). This guards the whole class of
 * "query references a column that does not exist" failures — the exact bug that
 * silently 503'd the calendar by reading `assignments.due_at` (the column is
 * `deadline_at`).
 *
 * Each query is a merged slice of the learner agenda:
 *   personal  — self-created calendar_events
 *   sessions  — mentor_sessions the learner is part of (as mentor or student)
 *   classes   — mentor_classes the learner mentors or belongs to
 *   deadlines — active assignments with a deadline, via ACTIVE classroom membership
 */
export const CALENDAR_PERSONAL_SQL = `SELECT id, title, note, starts_at, ends_at
   FROM calendar_events
  WHERE user_id = ? AND ends_at >= ? AND starts_at <= ?
  ORDER BY starts_at`;

export const CALENDAR_SESSIONS_SQL = `SELECT s.id, s.topic, s.starts_at, s.ends_at, s.status, s.kind, s.mentor_id,
        COALESCE(NULLIF(pm.display_name, ''), um.username, 'Mentor') AS mentor_name,
        COALESCE(NULLIF(ps.display_name, ''), us.username, 'Student') AS student_name
   FROM mentor_sessions s
   JOIN users um ON um.id = s.mentor_id
   JOIN users us ON us.id = s.student_id
   LEFT JOIN user_profiles pm ON pm.user_id = s.mentor_id
   LEFT JOIN user_profiles ps ON ps.user_id = s.student_id
  WHERE (s.mentor_id = ? OR s.student_id = ?) AND s.status IN ('SCHEDULED', 'ACTIVE')
    AND s.ends_at >= ? AND s.starts_at <= ?
  ORDER BY s.starts_at`;

export const CALENDAR_CLASSES_SQL = `SELECT c.id, c.title, c.starts_at, c.ends_at, c.status
   FROM mentor_classes c
  WHERE (c.mentor_id = ? OR EXISTS (SELECT 1 FROM mentor_class_members m WHERE m.class_id = c.id AND m.user_id = ?))
    AND c.ends_at >= ? AND c.starts_at <= ?
  ORDER BY c.starts_at`;

export const CALENDAR_DEADLINES_SQL = `SELECT a.id, a.title, a.deadline_at
   FROM assignments a
   JOIN classroom_members m ON m.classroom_id = a.classroom_id AND m.user_id = ? AND m.status = 'ACTIVE'
  WHERE a.status = 'ACTIVE' AND ${assignmentEligible('a','m.user_id')} AND a.deadline_at IS NOT NULL AND a.deadline_at >= ? AND a.deadline_at <= ?
  ORDER BY a.deadline_at`;

/** Teaching deadlines for classes owned or actively co-taught by the current user. */
export const CALENDAR_TEACHER_DEADLINES_SQL = `SELECT a.id,a.title,a.deadline_at,c.name AS classroom_name
 FROM assignments a JOIN classrooms c ON c.id=a.classroom_id
 WHERE c.status='ACTIVE' AND a.status IN ('ACTIVE','CLOSED') AND a.deadline_at IS NOT NULL
 AND a.deadline_at>=? AND a.deadline_at<=?
 AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=? AND m.role='CO_TEACHER' AND m.status='ACTIVE'))
 ORDER BY a.deadline_at LIMIT 500`;
/** School-wide events from approved schools where this staff member is active. */
export const CALENDAR_STAFF_SCHOOL_EVENTS_SQL = `SELECT e.id,e.title,e.description,e.starts_at,e.ends_at,s.name AS school_name
 FROM school_events e JOIN schools s ON s.id=e.school_id
 JOIN school_members m ON m.school_id=s.id AND m.user_id=? AND m.status='ACTIVE'
 WHERE s.status='APPROVED' AND e.ends_at>=? AND e.starts_at<=?
 ORDER BY e.starts_at LIMIT 500`;

/** Internal marking deadlines are visible only to class owner and co-teachers. */
export const CALENDAR_MARKING_DEADLINES_SQL = `SELECT a.id,a.title,md.deadline_at,c.name AS classroom_name
 FROM assignment_marking_deadlines md JOIN assignments a ON a.id=md.assignment_id JOIN classrooms c ON c.id=a.classroom_id
 WHERE c.status='ACTIVE' AND a.status IN ('ACTIVE','CLOSED') AND md.deadline_at>=? AND md.deadline_at<=?
 AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=? AND m.role='CO_TEACHER' AND m.status='ACTIVE'))
 ORDER BY md.deadline_at LIMIT 500`;

export const CALENDAR_SUPPORT_SQL = `SELECT s.id,s.starts_at,s.ends_at,c.name AS classroom_name,s.status,s.teacher_id,s.student_id
 FROM teacher_support_slots s JOIN classrooms c ON c.id=s.classroom_id AND c.status='ACTIVE'
 JOIN users teacher ON teacher.id=s.teacher_id AND teacher.status='ACTIVE'
 WHERE s.status IN ('OPEN','BOOKED') AND s.ends_at>=? AND s.starts_at<=?
 AND (c.teacher_id=s.teacher_id OR EXISTS(SELECT 1 FROM classroom_members ct WHERE ct.classroom_id=c.id AND ct.user_id=s.teacher_id AND ct.role='CO_TEACHER' AND ct.status='ACTIVE'))
 AND ((s.teacher_id=?) OR (s.student_id=? AND s.status='BOOKED' AND EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=s.student_id AND m.role='STUDENT' AND m.status='ACTIVE')))
 ORDER BY s.starts_at LIMIT 500`;

export const CALENDAR_TEACHING_SQL = `SELECT e.id,e.title,e.starts_at,e.ends_at,e.kind,e.note,c.name AS classroom_name FROM classroom_teaching_events e JOIN classrooms c ON c.id=e.classroom_id AND c.status='ACTIVE' JOIN users u ON u.id=e.teacher_id AND u.status='ACTIVE'
 WHERE e.ends_at>=? AND e.starts_at<=? AND (c.teacher_id=e.teacher_id OR EXISTS(SELECT 1 FROM classroom_members ct WHERE ct.classroom_id=c.id AND ct.user_id=e.teacher_id AND ct.role='CO_TEACHER' AND ct.status='ACTIVE'))
 AND (e.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=? AND m.role='STUDENT' AND m.status='ACTIVE')) ORDER BY e.starts_at LIMIT 500`;

export const CALENDAR_WORKSHEET_DEADLINES_SQL = `SELECT w.id,w.title,w.deadline_at,c.name AS classroom_name FROM class_worksheets w JOIN classrooms c ON c.id=w.classroom_id AND c.status='ACTIVE' WHERE w.status='ACTIVE' AND w.deadline_at>=? AND w.deadline_at<=? AND (c.teacher_id=? OR EXISTS(SELECT 1 FROM classroom_members m WHERE m.classroom_id=c.id AND m.user_id=? AND m.status='ACTIVE' AND (m.role='STUDENT' OR (m.role='CO_TEACHER' AND COALESCE((SELECT d.can_grade FROM classroom_co_teacher_duties d WHERE d.member_id=m.id),1)=1)))) ORDER BY w.deadline_at LIMIT 500`;
